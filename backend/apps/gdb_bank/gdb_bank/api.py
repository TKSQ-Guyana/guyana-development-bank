"""Whitelisted REST endpoints for the GDB citizen portal.

All endpoints are called as POST /api/method/gdb_bank.api.<name> with a JSON
body. Authentication is the standard Frappe session cookie obtained from
POST /api/method/login.

Storage is the official frappe/lending app's **Loan Application** doctype;
this module maps the stable portal contract (loan_amount, purpose,
term_months, monthly_income, phone, status Submitted/Approved/Rejected) onto
it. Portal-only facts live in gdb_* custom fields (see install.CUSTOM_FIELDS).
"""

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, flt, now_datetime, nowdate

# The citizen-portal business logic now lives in services/, over a shared utils/
# foundation (api -> services -> utils, one way). api.py keeps every
# @frappe.whitelist() name so the URLs never move, and re-imports the helpers
# below so `from gdb_bank.api import X` keeps resolving for the sibling modules
# (collections, conditions, documents, identity, offers, permissions, profiles,
# rules) that already import them from here.
from gdb_bank.utils.constants import (  # noqa: F401  (re-exported for siblings)
	LOAN_FIELDS,
	STAFF_ROLES,
	STATUS_FROM_PORTAL,
	STATUS_TO_PORTAL,
)
from gdb_bank.utils.formatters import _portal_dict, _stage_context
from gdb_bank.utils.session import (  # noqa: F401  (re-exported for siblings)
	_as_system,
	_eids,
	_is_disbursement,
	_is_finance,
	_is_staff,
	_is_underwriter,
	_logger,
	_require_disbursement,
	_require_finance,
	_require_staff,
	_require_underwriter,
	_session_user,
)
from gdb_bank.services import (
	application as application_service,
	finance as finance_service,
	user as user_service,
)
# Re-exported for siblings; _get_or_create_customer is also used by save_bank_details.
from gdb_bank.services.application import _readable_application  # noqa: F401
from gdb_bank.services.finance import repayment_plan  # noqa: F401
from gdb_bank.services.user import _get_or_create_customer

@frappe.whitelist(allow_guest=True)
def signup(full_name: str, email: str, password: str):
	"""Citizen self-registration: creates a Website User with the Citizen role."""
	return user_service.signup(full_name, email, password)


@frappe.whitelist()
def whoami():
	return user_service.whoami(_session_user())


def _cluster_for(user: str, cluster: str | None) -> str:
	"""Which cluster, if any, this application is filed against.

	Belonging to a cluster is not the same as borrowing for it. This used to
	read `cluster or _cluster_of(user)`, which made the tag a side effect of
	membership: once a citizen joined a group, every loan they took — the
	group's seed capital and their own roof repair alike — arrived on an
	underwriter's desk as the group's, and the applicant was never asked.
	So the choice is the caller's now, and the default is the applicant's own.

	A cluster loan is a DIFFERENT PRODUCT, not a decoration on a personal one,
	so it is never reached by accident. Filing against a group takes naming it:
	omitting the argument means the applicant's own application, exactly as ""
	does. That is a deliberate break with the older `apply_loan` behaviour,
	where an omitted cluster meant "whatever group I am in" — a default that
	tagged a member's roof-repair loan as the group's, and did it precisely for
	the applicants least likely to notice.

	Two rules hold whatever is passed, because this value decided nothing
	before it and now decides whose case an underwriter is reading:
	  - you may only file against a cluster you are an ACTIVE member of;
	  - only the HEAD may borrow on the group's behalf.
	"""
	if cluster is None:
		return ""

	cluster = (cluster or "").strip()
	if not cluster:
		return ""
	if cluster not in _clusters_of(user):
		frappe.throw(
			_("You are not a member of cluster {0}.").format(cluster), frappe.PermissionError
		)
	_require_head(user, cluster)
	return cluster


@frappe.whitelist()
def save_application(
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
	name: str | None = None,
):
	"""Create or update the applicant's own DRAFT application."""
	return application_service.save_application(
		_session_user(),
		loan_amount,
		purpose,
		term_months,
		monthly_income=monthly_income,
		phone=phone,
		cluster=cluster,
		business_stage=business_stage,
		dcra_number=dcra_number,
		business_name=business_name,
		sections=sections,
		name=name,
	)


@frappe.whitelist()
def submit_application(name: str):
	"""Put a draft before the Bank. Evidence is EXPECTED but never blocking."""
	return application_service.submit_application(_session_user(), name)


@frappe.whitelist()
def discard_application(name: str):
	"""Abandon a draft. Only ever a draft — once submitted it is the Bank record
	of what was asked for, and withdrawal is a decision rather than a delete."""
	return application_service.discard_application(_session_user(), name)


@frappe.whitelist()
def apply_loan(
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
):
	"""Save and submit in one call, for an applicant with evidence already filed.

	Kept because it is the published contract (docs/openapi.yaml, the Postman
	collection). It is the two steps back to back, gate included: it cannot
	submit what save_application would not have saved.
	"""
	return application_service.apply_loan(
		_session_user(),
		loan_amount,
		purpose,
		term_months,
		monthly_income=monthly_income,
		phone=phone,
		cluster=cluster,
		business_stage=business_stage,
		dcra_number=dcra_number,
		business_name=business_name,
		sections=sections,
	)


def _is_shared_with(row, user: str) -> bool:
	"""True when this is the head's application for a cluster the user is on.

	The head applies for the whole cluster, so that one case is the group's —
	every member may open it. A member's own application stays their own.
	"""
	cluster = row.get("gdb_cluster")
	if not cluster or cluster not in _clusters_of(user):
		return False
	return frappe.db.get_value("GDB Cluster", cluster, "head") == row.get("gdb_owner")


@frappe.whitelist()
def my_loans():
	"""The logged-in citizen's applications, newest first."""
	return application_service.my_loans(_session_user())


@frappe.whitelist()
def loan_detail(name: str):
	return application_service.loan_detail(_session_user(), name)


def _evidence_missing_map(rows) -> dict:
	"""Expected-but-absent document types per application, batched.

	Same trade as _stage_context: the review queue renders a whole list, so
	this is one document query for every case on screen rather than
	documents.missing_evidence's one-query-per-application — which is the
	right shape for a single case page, and the wrong shape multiplied by a
	queue's worth of rows.

	Deferred import: documents.py imports from this module at load time, so
	importing it back at module scope here would be circular.
	"""
	from gdb_bank.documents import PERSONAL_TYPES, REPLACED, required_types

	names = [r.name for r in rows]
	if not names:
		return {}
	owners = {r.name: r.gdb_owner for r in rows}
	stages = {r.name: r.gdb_business_stage for r in rows}

	doc_rows = frappe.get_all(
		"GDB Applicant Document",
		filters={
			"applicant": ["in", list(set(owners.values()))],
			"status": ["!=", REPLACED],
			"file_url": ["is", "set"],
		},
		fields=["applicant", "application", "document_type"],
	)
	by_owner: dict = {}
	for d in doc_rows:
		by_owner.setdefault(d.applicant, []).append(d)

	missing = {}
	for name in names:
		held = {
			d.document_type
			for d in by_owner.get(owners.get(name), [])
			if d.application == name or (not d.application and d.document_type in PERSONAL_TYPES)
		}
		missing[name] = [t for t in required_types(stages.get(name)) if t not in held]
	return missing


@frappe.whitelist()
def all_loans(status: str | None = None):
	"""The bank's queue: every citizen application, optionally by status.

	Drafts are excluded and that is not a filter but a rule: an application the
	applicant has not submitted is not before the Bank, and staff reading one
	would be reading a half-finished statement as though it had been made.

	Open to both staff roles — finance needs the same queue to see what is
	approved and awaiting release — but reading a case and deciding it are
	different acts, and only `review_loan` decides.
	"""
	user = _session_user()
	if not _is_staff(user):
		_logger().warning(f"denied staff queue to {user}")
		frappe.throw(_("Only GDB staff may do this."), frappe.PermissionError)
	filters = {"docstatus": 1}
	if status:
		filters["status"] = STATUS_FROM_PORTAL.get(status, status)
	rows = frappe.get_all(
		"Loan Application",
		filters=filters,
		fields=LOAN_FIELDS,
		order_by="creation desc",
	)
	eids = _eids([r.gdb_owner for r in rows])
	ctx = _stage_context([r.name for r in rows])
	evidence = _evidence_missing_map(rows)
	result = [_portal_dict(r, eids, ctx) for r in rows]
	for portal_row, row in zip(result, rows):
		# Additive, queue-only: loan_detail already renders the live shelf via
		# DocumentShelf, so _portal_dict's shared shape stays as it was for
		# every other caller.
		portal_row["evidence_missing"] = evidence.get(row.name, [])
	return result


@frappe.whitelist()
def review_loan(name: str, action: str, remarks: str | None = None):
	"""Underwriter decision on an application: approve | reject."""
	user = _require_underwriter()
	doc = frappe.get_doc("Loan Application", name)

	# SEGREGATION OF DUTIES. Holding the underwriter role says you may decide
	# OTHER people's applications, never your own — an underwriter is also a
	# citizen who may borrow, and one account can legitimately hold both
	# capacities (more so now that a government persona can sign in from the
	# staff realm and hold `Citizen` alongside their staff role). Without this
	# the same person could file and approve in two calls.
	if doc.gdb_owner == user:
		frappe.throw(
			_("You cannot review your own application. Ask another underwriter."),
			frappe.PermissionError,
		)

	new_status = {"approve": "Approved", "reject": "Rejected"}.get(action)
	if not new_status:
		frappe.throw(_("Unknown action: {0}").format(action))
	if doc.status != "Open":
		frappe.throw(_("Cannot {0} an application in status {1}.").format(action, doc.status))

	# db_set: the doc is submitted (docstatus 1); status is permlevel-guarded
	# and the review fields are allow_on_submit.
	doc.db_set("status", new_status)
	if remarks:
		doc.db_set("gdb_remarks", remarks.strip())
	doc.db_set("gdb_reviewed_by", user)
	doc.db_set("gdb_reviewed_on", now_datetime())
	frappe.db.commit()
	_logger().info(f"loan {doc.name}: {action} by {user} -> {new_status}")
	return _portal_dict(frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True))


# --------------------------------------------------------------------------
# Clusters (capability C4)
#
# A cluster groups applicants who share a project and a plan. It never
# borrows: every member holds their own Loan Application, decision and Loan.
# --------------------------------------------------------------------------


@frappe.whitelist()
def convert_lead(lead: str, cluster: str | None = None, purpose: str | None = None):
	"""Turn a submitted Loan Lead into a Loan Application.

	lending ships convert_to_loan_application but types its argument as a
	Document, so frappe's typing validation rejects any REST payload, and
	loan_lead.js adds no button — from a portal the function is unreachable.
	This wrapper hands it the real doc (it prefills the applicant fields and
	resolves Customer + company), then adds the facts only GDB knows.
	"""
	user = _require_underwriter()
	lead_doc = frappe.get_doc("Loan Lead", lead)
	if lead_doc.docstatus != 1:
		frappe.throw(_("Submit lead {0} before converting it.").format(lead))

	from lending.loan_origination.doctype.loan_lead.loan_lead import convert_to_loan_application

	# the converter returns nothing, so diff the table to find what it made
	before = set(frappe.get_all("Loan Application", pluck="name"))
	convert_to_loan_application(lead_doc)
	created = set(frappe.get_all("Loan Application", pluck="name")) - before
	if not created:
		frappe.throw(_("Lead {0} produced no application.").format(lead))

	doc = frappe.get_doc("Loan Application", created.pop())
	doc.is_term_loan = 1
	doc.repayment_method = "Repay Over Number of Periods"
	doc.gdb_owner = frappe.db.get_value("User", {"email": lead_doc.email}) or user
	doc.gdb_purpose = (purpose or "").strip()
	doc.gdb_monthly_income = flt(lead_doc.income)
	if cluster:
		doc.gdb_cluster = cluster
	doc.save()
	frappe.db.commit()
	_logger().info(f"lead {lead} -> application {doc.name} by {user}")
	return _portal_dict(frappe.db.get_value("Loan Application", doc.name, LOAN_FIELDS, as_dict=True))
def _clusters_of(user: str) -> list[str]:
	"""Every cluster this user has JOINED. The one place membership is decided.

	Active only. An invitation is not membership: someone who has been asked
	and not yet answered must not have the group's application appear in their
	list.

	A person may belong to as many clusters as they are invited to and accept.
	That is the whole reason this returns a list: a fisherman can be in the
	landing-site cold-store group and the boat-repair group at once, and
	neither membership is a reason to refuse the other. Every question about
	membership — which cases are readable, which cluster an application may be
	filed against, what the desk may see — comes through here, so multi-cluster
	is implemented once rather than re-derived at each call site.
	"""
	return frappe.get_all(
		"GDB Cluster Member",
		filters={"member": user, "member_status": "Active"},
		pluck="parent",
	)


def _cluster_of(user: str) -> str | None:
	"""The FIRST cluster this user joined, or None.

	Kept because a single cluster was the only possibility when much of this
	module was written, and a caller that genuinely wants one cluster — a
	default to offer, a heading to print — should not have to say which.
	Anything deciding permission or visibility must use `_clusters_of`: asking
	"which cluster is this person in" of somebody in three is a question with
	no correct answer.
	"""
	clusters = _clusters_of(user)
	return clusters[0] if clusters else None


def _invitation_of(user: str, eid: str | None = None):
	"""An outstanding invitation for this person, by user or by bare e-ID.

	The e-ID arm is what lets a head invite somebody who has never signed in:
	the row exists against the e-ID alone until identity.py links it.
	"""
	rows = frappe.get_all(
		"GDB Cluster Member",
		filters={"member": user, "member_status": "Invited"},
		fields=["name", "parent", "member_eid"],
	)
	if not rows and eid:
		rows = frappe.get_all(
			"GDB Cluster Member",
			filters={"member_eid": eid, "member_status": "Invited"},
			fields=["name", "parent", "member_eid"],
		)
	return rows[0] if rows else None


def link_pending_invitations(user: str, eid: str) -> int:
	"""Attach invitations raised against an e-ID to the User it turned out to be.

	Called from identity.py on e-ID sign-in. Until this runs the row names an
	e-ID and no user, which is exactly right — an invitation is issued to a
	person, and the portal account is how they answer it, not what they are.
	"""
	rows = frappe.get_all(
		"GDB Cluster Member",
		filters={"member_eid": eid, "member": ["in", ["", None]]},
		fields=["name", "parent"],
	)
	for row in rows:
		frappe.db.set_value(
			"GDB Cluster Member",
			row.name,
			{"member": user, "member_name": frappe.utils.get_fullname(user)},
			update_modified=False,
		)
	if rows:
		frappe.db.commit()
		_logger().info(f"linked {len(rows)} cluster invitation(s) for {eid} -> {user}")
	return len(rows)


def _require_head(user: str, cluster: str) -> None:
	if frappe.db.get_value("GDB Cluster", cluster, "head") != user:
		frappe.throw(_("Only the cluster head may do this."), frappe.PermissionError)


def _head_cluster(user: str, cluster: str | None) -> str:
	"""Resolve which of the caller's clusters they are acting as head of.

	Named, or — for the single-cluster caller this app used to assume — the
	only one they are in. Somebody in two groups who does not say which gets
	asked rather than guessed at: an invitation sent to the wrong group is not
	something the recipient can be expected to notice.
	"""
	cluster = (cluster or "").strip()
	joined = _clusters_of(user)
	if not cluster:
		if not joined:
			frappe.throw(_("You are not in a cluster."))
		if len(joined) > 1:
			frappe.throw(_("Say which cluster this is for."))
		cluster = joined[0]
	elif cluster not in joined:
		frappe.throw(
			_("You are not a member of cluster {0}.").format(cluster), frappe.PermissionError
		)
	_require_head(user, cluster)
	return cluster


def _require_shared_editor(user: str, cluster: str) -> None:
	"""Who may write the group's SHARED sections: the head, or the facilitator.

	The facilitator is attached to help a group put its plan together, so a
	facilitator who can only read one is no help at all. This is the whole of
	their authority: it is checked here, on the shared plan, and nowhere near
	an application, an assessment, a decision or an offer — none of which a
	facilitator may touch, and none of which call this.

	Each member's own sections are not shared sections, and are not covered.
	"""
	row = frappe.db.get_value(
		"GDB Cluster", cluster, ["head", "facilitator"], as_dict=True
	)
	if not row:
		frappe.throw(_("Cluster {0} not found.").format(cluster))
	if user not in (row.head, row.facilitator):
		frappe.throw(
			_("Only the cluster head or its facilitator may edit the shared plan."),
			frappe.PermissionError,
		)


@frappe.whitelist()
def create_cluster(
	cluster_name: str,
	region: str | None = None,
	sector: str | None = None,
	loan_purpose: str | None = None,
	business_plan: str | None = None,
	group_purpose: str | None = None,
	locality: str | None = None,
	is_registered: str | None = None,
	facilitator_eid: str | None = None,
	facilitator_requested: int | None = None,
):
	"""A citizen starts a cluster and becomes its head.

	Belonging to a group is no longer a reason to refuse another one. One
	person's businesses can share a cold store with their neighbours and a
	boat-repair shed with a different set of people, and asking them to pick
	one would not make either group less real. So the only uniqueness left is
	the cluster's own name.

	Everything after `business_plan` is new and optional, which is what keeps
	the older two-argument call — the one `Cluster.tsx` still makes — working
	unchanged.
	"""
	user = _session_user()
	cluster_name = (cluster_name or "").strip()
	if not cluster_name:
		frappe.throw(_("Cluster name is required."))
	if frappe.db.exists("GDB Cluster", cluster_name):
		frappe.throw(_("A cluster called {0} already exists.").format(cluster_name))

	doc = frappe.get_doc(
		{
			"doctype": "GDB Cluster",
			"cluster_name": cluster_name,
			"region": (region or "").strip(),
			"sector": (sector or "").strip(),
			"loan_purpose": (loan_purpose or "").strip(),
			"business_plan": (business_plan or "").strip(),
			"group_purpose": (group_purpose or "").strip(),
			"locality": (locality or "").strip(),
			"is_registered": (is_registered or "").strip(),
			"head": user,
			"status": "Active",
			"members": [
				{
					"member": user,
					"member_name": frappe.utils.get_fullname(user),
					"member_eid": frappe.db.get_value("User", user, "gdb_eid"),
					"member_status": "Active",
					"is_head": 1,
					"joined_on": nowdate(),
				}
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"cluster {doc.name} created by {user}")

	# After the insert, so a facilitator e-ID that turns out to be unusable
	# costs the head the facilitator and not the group they just named.
	if cint(facilitator_requested) or (facilitator_eid or "").strip():
		attach_facilitator(doc.name, facilitator_eid, requested=1)

	return cluster_view(doc.name)


@frappe.whitelist()
def invite_member(eid: str, full_name: str | None = None, cluster: str | None = None):
	"""The head INVITES somebody by e-ID. They join by accepting, not by being added.

	This used to take an email address, mint a portal account and drop the
	person straight onto the roster as Active — with a one-time password handed
	back for the head to pass along. Two things were wrong with that. A person
	was made a member of a group without ever agreeing to it, and their
	credential travelled through somebody else's hands.

	So: the head names an e-ID, which is who a person IS rather than a mailbox
	they happen to hold; the row is written as Invited; and the invitation is
	answered by that person, signed in as themselves. If they have never signed
	in, the row waits against the bare e-ID until they do (link_pending_invitations).

	`cluster` names which group the invitation is to. It is optional only so
	that the older caller — which could not have named one, because there was
	only ever one — keeps working; a head of two groups must say which, or the
	invitation would land in whichever one happened to come back first.
	"""
	user = _session_user()
	cluster = _head_cluster(user, cluster)

	from gdb_bank.identity import normalize_eid

	eid = normalize_eid(eid)
	full_name = (full_name or "").strip()

	invitee = frappe.db.get_value("User", {"gdb_eid": eid}, "name")
	if invitee:
		if invitee == user:
			frappe.throw(_("You are already the head of this cluster."))
		# Belonging elsewhere is no longer a bar. Belonging HERE is: the
		# check that matters is against this cluster's own roster, below.
		full_name = full_name or frappe.utils.get_fullname(invitee)

	doc = frappe.get_doc("GDB Cluster", cluster)
	for row in doc.get("members") or []:
		if row.member_eid == eid or (invitee and row.member == invitee):
			if row.member_status in ("Invited", "Active"):
				frappe.throw(
					_("{0} has already been invited to this cluster.").format(eid)
				)
			row.member_status = "Invited"
			row.invited_on = nowdate()
			row.responded_on = None
			doc.save(ignore_permissions=True)
			frappe.db.commit()
			return cluster_view(cluster)

	doc.append(
		"members",
		{
			"member": invitee,
			"member_eid": eid,
			"member_name": full_name or eid,
			"member_status": "Invited",
			"invited_on": nowdate(),
		},
	)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"{user} invited {eid} to cluster {cluster} (user: {invitee or 'not yet'})")
	return cluster_view(cluster)


@frappe.whitelist()
def my_invitations():
	"""Clusters this person has been asked to join and has not yet answered."""
	user = _session_user()
	eid = frappe.db.get_value("User", user, "gdb_eid")
	rows = frappe.get_all(
		"GDB Cluster Member",
		filters={"member": user, "member_status": "Invited"},
		fields=["parent", "invited_on"],
	)
	if not rows and eid:
		rows = frappe.get_all(
			"GDB Cluster Member",
			filters={"member_eid": eid, "member_status": "Invited"},
			fields=["parent", "invited_on"],
		)
	out = []
	for row in rows:
		cluster = frappe.db.get_value(
			"GDB Cluster", row.parent, ["name", "cluster_name", "region", "sector", "head"], as_dict=True
		)
		if not cluster:
			continue
		cluster["invited_on"] = row.invited_on
		cluster["head_name"] = frappe.utils.get_fullname(cluster.head)
		out.append(cluster)
	return out


@frappe.whitelist()
def respond_to_invitation(cluster: str, accept=1):
	"""Accept or decline. The invitee's own act, and nobody else's.

	Accepting is also the moment the row stops being an e-ID and becomes a
	member: `member` is stamped from the session, so a row can never be
	activated for somebody other than the person answering it.
	"""
	user = _session_user()
	accepting = bool(cint(accept))
	eid = frappe.db.get_value("User", user, "gdb_eid")

	doc = frappe.get_doc("GDB Cluster", cluster)
	row = None
	for member in doc.get("members") or []:
		if member.member_status != "Invited":
			continue
		if member.member == user or (eid and member.member_eid == eid):
			row = member
			break
	if not row:
		frappe.throw(_("You have no outstanding invitation to {0}.").format(cluster))

	if accepting:
		row.member = user
		row.member_name = frappe.utils.get_fullname(user)
		row.member_eid = row.member_eid or eid
		row.member_status = "Active"
		row.joined_on = nowdate()
	else:
		row.member_status = "Declined"
	row.responded_on = nowdate()

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(
		f"{user} {'accepted' if accepting else 'declined'} the invitation to {cluster}"
	)
	return cluster_view(cluster) if accepting else {"declined": cluster}


@frappe.whitelist()
def save_plan(
	loan_purpose: str | None = None,
	business_plan: str | None = None,
	cluster: str | None = None,
):
	"""The head edits the shared purpose and the legacy free-text plan.

	Untouched apart from taking the cluster it is editing, which a caller in
	one group may still omit. The seven sectioned questions have their own
	endpoint — `save_cluster_plan` — so a portal built against this one keeps
	working and keeps writing to the same field it always did.
	"""
	user = _session_user()
	cluster = _head_cluster(user, cluster)

	doc = frappe.get_doc("GDB Cluster", cluster)
	if loan_purpose is not None:
		doc.loan_purpose = loan_purpose.strip()
	if business_plan is not None:
		doc.business_plan = business_plan.strip()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return cluster_view(cluster)


@frappe.whitelist()
def my_cluster():
	"""The caller's FIRST cluster, or None. Safe to call for every logged-in user.

	Left exactly as it was, for the portal pages written when one cluster was
	all anybody could have. `my_clusters` is the honest question now.
	"""
	user = _session_user()
	cluster = _cluster_of(user)
	return cluster_view(cluster) if cluster else None


@frappe.whitelist()
def my_clusters():
	"""Every cluster the caller is in, plus any they facilitate.

	The facilitated ones are included because a facilitator has no roster row
	— they are attached to the group, not a member of it — and a list that
	left them out would leave them with a cluster they can edit and no way to
	reach it.
	"""
	user = _session_user()
	names = list(_clusters_of(user))
	for name in frappe.get_all("GDB Cluster", filters={"facilitator": user}, pluck="name"):
		if name not in names:
			names.append(name)
	return [cluster_view(name) for name in names]


# The seven questions the shared plan asks. One list, so the doctype, the
# endpoint and the portal cannot drift into disagreeing about what a cluster
# plan consists of.
PLAN_SECTIONS = (
	"plan_executive_summary",
	"plan_how_formed",
	"plan_governance",
	"plan_market",
	"plan_shared_project",
	"plan_operations",
	"plan_impact",
)


@frappe.whitelist()
def save_cluster_plan(cluster: str, **sections):
	"""The head or the attached facilitator writes the shared plan.

	Only the seven shared sections, and only the ones passed: a facilitator
	filling in the market section must not blank the executive summary the
	head wrote, and two people working on the same plan should not have to
	take turns. Anything else in the payload is ignored rather than refused,
	because this endpoint's job is the plan and nothing near an application.
	"""
	user = _session_user()
	cluster = (cluster or "").strip()
	if not cluster:
		frappe.throw(_("Say which cluster this plan is for."))
	_require_shared_editor(user, cluster)

	doc = frappe.get_doc("GDB Cluster", cluster)
	written = []
	for field in PLAN_SECTIONS:
		value = sections.get(field)
		if value is None:
			continue
		doc.set(field, (value or "").strip())
		written.append(field)
	if not written:
		return cluster_view(cluster)

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"{user} wrote {len(written)} plan section(s) on cluster {cluster}")
	return cluster_view(cluster)


# PLACEHOLDER ROSTER. GDB has not published its regional facilitators yet and
# there is no Facilitator role on this site, so the list a head chooses from is
# stated here rather than invented in the browser — a citizen must never pick
# from a list the server cannot recognise. Each entry is a real national e-ID,
# so `attach_facilitator` links it to that person's User the moment they first
# sign in, exactly as it would for a real roster.
#
# TO GO LIVE: grant a `Facilitator` role and return the Users holding it,
# filtered by region. Nothing else below has to change — the endpoint's shape
# and the e-ID it hands back are already what the real answer looks like.
FACILITATOR_ROSTER = (
	{"eid": "592-6666-0006", "full_name": "Rani Singh", "region": "Region 2 — Pomeroon-Supenaam"},
	{"eid": "592-7777-0007", "full_name": "Devon Baksh", "region": "Region 3 — Essequibo Islands-West Demerara"},
	{"eid": "592-8888-0008", "full_name": "Marcia Khan", "region": "Region 4 — Demerara-Mahaica"},
	{"eid": "592-1010-0010", "full_name": "Anita Ramkissoon", "region": "Region 6 — East Berbice-Corentyne"},
	{"eid": "592-1122-0011", "full_name": "Trevor Adams", "region": "Region 9 — Upper Takutu-Upper Essequibo"},
	{"eid": "592-1133-0012", "full_name": "Shanta Narine", "region": "Region 10 — Upper Demerara-Berbice"},
)


@frappe.whitelist()
def facilitators(region: str | None = None):
	"""The GDB facilitators a group may ask for.

	Region is a FILTER, not a gate: a head is asked whether they want a
	facilitator before they are asked where the group works, and a list that
	came back empty at that point would read as "there are none". Passing a
	region moves that region's facilitators to the front instead of removing
	the others.

	`placeholder` is returned honestly rather than hidden — a screen showing
	names GDB has not actually appointed should be able to say so.
	"""
	_session_user()
	region = (region or "").strip()
	rows = [dict(row, placeholder=True) for row in FACILITATOR_ROSTER]
	if region:
		rows.sort(key=lambda r: r["region"] != region)
	return rows


@frappe.whitelist()
def save_cluster_details(
	cluster: str,
	region: str | None = None,
	sector: str | None = None,
	group_purpose: str | None = None,
	locality: str | None = None,
	is_registered: str | None = None,
):
	"""The group's own description: what it does, where, and whether it is registered.

	Separate from `save_cluster_plan` because these are facts about the group
	rather than the case it is making, and because the region is what GDB
	routes a facilitator on — it has to be editable without touching a word of
	the plan. Head or facilitator, same rule as the plan.

	Only the fields passed are written, so the head correcting a village name
	cannot blank the region.
	"""
	user = _session_user()
	cluster = (cluster or "").strip()
	if not cluster:
		frappe.throw(_("Say which cluster this is for."))
	_require_shared_editor(user, cluster)

	doc = frappe.get_doc("GDB Cluster", cluster)
	for field, value in (
		("region", region),
		("sector", sector),
		("group_purpose", group_purpose),
		("locality", locality),
		("is_registered", is_registered),
	):
		if value is not None:
			doc.set(field, (value or "").strip())
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return cluster_view(cluster)


@frappe.whitelist()
@rate_limit(limit=40, seconds=60 * 5)
def lookup_eid(eid: str):
	"""Who an e-ID belongs to, for a head filling in a members table.

	Answers a name ONLY for an e-ID that already holds a portal account, and
	nothing else about them — not their email, not their region, not whether
	they have ever borrowed. An unknown e-ID comes back as simply unknown,
	which is a perfectly good answer: an invitation may be issued to somebody
	who has never signed in.

	Rate-limited because a name-for-a-number endpoint is a directory if you
	let it be one. Eleven digits is a small enough space to walk, and the
	limit is what stops this being the way to walk it. The limit is per
	CALLER, not per e-ID looked up — keyed the other way it would count one
	request against each number and never fire, which is the shape of the
	enumeration it exists to stop.
	"""
	user = _session_user()
	from gdb_bank.identity import normalize_eid

	eid = normalize_eid(eid)

	row = frappe.db.get_value("User", {"gdb_eid": eid}, ["name", "enabled"], as_dict=True)
	if not row or not row.enabled:
		return {"eid": eid, "registered": False, "name": None}
	return {
		"eid": eid,
		"registered": True,
		"name": frappe.utils.get_fullname(row.name),
		"is_you": row.name == user,
	}


@frappe.whitelist()
def attach_facilitator(cluster: str, eid: str | None = None, requested: int | None = None):
	"""Name the GDB regional facilitator who will help this group.

	Named by e-ID, like everybody else in this bank. An e-ID with no portal
	account yet is still a valid answer: `facilitator_eid` holds it and the
	link is made on that person's first sign-in, exactly as an invitation to a
	member waits for them.

	Attaching somebody does NOT give them anything beyond the shared plan —
	see `_require_shared_editor`. It is not a role grant, and it is not a
	referral the Bank has accepted: `facilitator_requested` records that the
	group asked, which is the fact GDB routes on.
	"""
	user = _session_user()
	cluster = _head_cluster(user, cluster)
	doc = frappe.get_doc("GDB Cluster", cluster)

	eid = (eid or "").strip()
	if not eid:
		doc.facilitator = None
		doc.facilitator_eid = None
		doc.facilitator_name = None
		doc.facilitator_requested = cint(requested)
	else:
		from gdb_bank.identity import normalize_eid

		eid = normalize_eid(eid)
		if eid == frappe.db.get_value("User", user, "gdb_eid"):
			frappe.throw(_("You cannot be your own group's facilitator."))
		match = frappe.db.get_value("User", {"gdb_eid": eid}, "name")
		doc.facilitator = match
		doc.facilitator_eid = eid
		doc.facilitator_name = frappe.utils.get_fullname(match) if match else None
		doc.facilitator_requested = 1

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"{user} set facilitator {eid or '(none)'} on cluster {cluster}")
	return cluster_view(cluster)


def link_pending_facilitator(user: str, eid: str) -> int:
	"""Attach clusters that named this e-ID as facilitator before they signed in.

	The mirror of `link_pending_invitations`, and called from the same place.
	"""
	rows = frappe.get_all(
		"GDB Cluster",
		filters={"facilitator_eid": eid, "facilitator": ["in", ["", None]]},
		pluck="name",
	)
	for name in rows:
		frappe.db.set_value(
			"GDB Cluster",
			name,
			{"facilitator": user, "facilitator_name": frappe.utils.get_fullname(user)},
			update_modified=False,
		)
	if rows:
		frappe.db.commit()
		_logger().info(f"linked {len(rows)} cluster facilitator row(s) for {eid} -> {user}")
	return len(rows)


@frappe.whitelist()
def cluster_view(cluster: str):
	"""Plan, roster and the applications raised under a cluster.

	The head applies on behalf of the cluster, so that application is shared:
	every member sees it in full. An application a member raises on their own
	stays theirs — others see only that it exists and how far it has moved.
	"""
	user = _session_user()
	doc = frappe.get_doc("GDB Cluster", cluster)
	roster = [m.as_dict() for m in doc.get("members") or []]
	# Invited members are on this list too: somebody deciding whether to accept
	# has to be able to see the plan they would be joining. What they do NOT
	# see is any other member's own case — that filter is below and applies to
	# every non-staff reader alike.
	members = {m.get("member") for m in roster if m.get("member")}
	if not (_is_staff(user) or user in members or user == doc.facilitator):
		frappe.throw(_("You are not a member of this cluster."), frappe.PermissionError)

	cases = []
	for row in frappe.get_all(
		"Loan Application",
		filters={"gdb_cluster": cluster},
		fields=LOAN_FIELDS,
		order_by="creation asc",
	):
		shared = row.gdb_owner == doc.head
		if shared or row.gdb_owner == user or _is_staff(user):
			cases.append(dict(_portal_dict(row), shared=shared, private=False))
		else:
			cases.append(
				{
					"name": row.name,
					"applicant_name": row.applicant_name,
					"status": STATUS_TO_PORTAL.get(row.status, row.status),
					"shared": False,
					"private": True,
				}
			)

	# Staff reading a cluster case need to know who the other members are, so
	# the roster carries each member's own details for them. Members see each
	# other's names and e-IDs and nothing else — the plan is shared, the people
	# are not each other's business.
	staff = _is_staff(user)
	profiles = {}
	if staff:
		for row in frappe.get_all(
			"GDB Citizen Profile",
			filters={"user": ["in", [m.get("member") for m in roster if m.get("member")] or [""]]},
			fields=["user", "phone", "region", "village_or_town", "occupation", "verified_phone"],
		):
			profiles[row.user] = row

	return {
		"name": doc.name,
		"region": doc.region,
		"sector": doc.sector,
		"loan_purpose": doc.loan_purpose,
		"business_plan": doc.business_plan,
		"group_purpose": doc.group_purpose,
		"locality": doc.locality,
		"is_registered": doc.is_registered,
		"facilitator": doc.facilitator,
		"facilitator_eid": doc.facilitator_eid,
		"facilitator_name": doc.facilitator_name,
		"facilitator_requested": bool(doc.facilitator_requested),
		"plan": {field: doc.get(field) for field in PLAN_SECTIONS},
		"head": doc.head,
		"is_head": doc.head == user,
		# The facilitator writes the shared plan and nothing else. The SPA
		# mirrors this to decide what to enable; api enforces it either way.
		"is_facilitator": bool(doc.facilitator) and doc.facilitator == user,
		"can_edit_plan": user in (doc.head, doc.facilitator),
		"viewer": user,
		"members": [
			{
				"member": m.get("member"),
				"member_eid": m.get("member_eid"),
				"member_name": m.get("member_name"),
				"member_status": m.get("member_status"),
				"is_head": bool(m.get("is_head")),
				"is_you": m.get("member") == user,
				"invited_on": m.get("invited_on"),
				"joined_on": m.get("joined_on"),
				"profile": profiles.get(m.get("member")) if staff else None,
			}
			for m in roster
		],
		"applications": cases,
	}


# --------------------------------------------------------------------------
# The loan account a borrower sees once the application is booked
# --------------------------------------------------------------------------


@frappe.whitelist()
def loan_account(application: str):
	"""Booked loan, repayment schedule and what is left to pay.

	Returns loan: None while the application is still with the underwriter.
	"""
	return application_service.loan_account(_session_user(), application)


@frappe.whitelist()
def make_repayment(application: str, amount):
	"""Record a repayment against the loan booked from this application.

	Any member of the cluster may pay the group's facility — the ledger records
	who made the payment, not only whose facility it is. GDB staff may not: see
	finance._may_repay.
	"""
	return finance_service.make_repayment(_session_user(), application, amount)


# --------------------------------------------------------------------------
# Booking and disbursement — the bank's side of an approved application
#
# Both steps are lending's own. `create_loan` is lending's mapper from a
# submitted Loan Application onto a Loan; disbursement is lending's Loan
# Disbursement doctype, whose submit is what generates the repayment schedule.
# Nothing here computes money: the schedule, the interest and the balances are
# lending's answer, exactly as they are in loan_account. What this module adds
# is who may ask, and when.
# --------------------------------------------------------------------------


BOOKED_LOAN_FIELDS = [
	"name",
	"status",
	"company",
	"applicant",
	"applicant_type",
	"loan_amount",
	"disbursed_amount",
]


def _booked_loan(application: str):
	"""The Loan booked from this application, if one exists yet."""
	return frappe.db.get_value(
		"Loan", {"loan_application": application}, BOOKED_LOAN_FIELDS, as_dict=True
	)


@frappe.whitelist()
def book_loan(application: str):
	"""Create the Loan for an approved application. DISBURSEMENT OFFICER ONLY.

	Booking is a decision the bank makes after approval, not a consequence of
	it — which is why this is a separate act with its own audit line rather
	than a hook on review_loan.

	It belongs to the disbursement officer rather than to the underwriter
	because booking is the first step on the money side: it puts a real Loan on
	GDB's books with its own schedule and its own GL entries, and everything
	after it is a drawdown. The officer who assessed the credit says whether
	GDB will lend; the officer who moves money says when the facility exists.
	Keeping the two in one pair of hands would make the four-eyes gate on
	disburse_loan the only thing standing between a decision and cash.
	"""
	user = _require_disbursement()

	row = frappe.db.get_value(
		"Loan Application", application, ["name", "status", "gdb_owner"], as_dict=True
	)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if row.status != "Approved":
		frappe.throw(
			_("Only an approved application can be booked ({0} is {1}).").format(
				application, STATUS_TO_PORTAL.get(row.status, row.status)
			)
		)

	existing = _booked_loan(application)
	if existing:
		frappe.throw(_("Loan {0} is already booked for {1}.").format(existing.name, application))

	# An approval is a credit decision; it does not bind either side. What puts
	# a borrower on GDB's books is their acceptance of the Letter of Offer, so
	# booking waits for the executed agreement rather than the decision.
	from gdb_bank.offers import accepted_offer

	agreement = accepted_offer(application)
	if not agreement:
		frappe.throw(
			_("No accepted offer for {0}. Issue a Letter of Offer and wait for the "
			  "applicant to accept it before booking.").format(application)
		)

	# lending guards its own mapper with has_permission("Loan", "create"), a
	# permission no portal role holds. Who may ask has been settled above, so
	# the write runs as the system — the same shape as make_repayment.
	from lending.loan_management.doctype.loan_application.loan_application import create_loan

	with _as_system():
		loan = create_loan(application, submit=1)
		frappe.db.commit()

	_logger().info(f"loan {loan.name} booked from {application} by {user}")
	return loan_account(application)


@frappe.whitelist()
def disburse_loan(application: str, amount=None):
	"""Release funds on a booked loan. DISBURSEMENT OFFICER ONLY, and never the
	person who approved it.

	TWO GATES, because one would not hold. The role gate says money movement
	belongs to the disbursement officer, not to the officer who assessed the
	credit and not to finance, who manages the books but never releases funds.
	The four-eyes gate below says that even a person holding both the deciding
	and releasing roles — which happens in a small bank, and which nothing
	stops an administrator from granting — cannot be both the decider and the
	releaser on the SAME case. Without the second gate the first is a naming
	convention: R-131 was proven end to end on this stack, one login carrying
	an application from decision to G$99,000,000 disbursed.

	Omit `amount` to disburse everything lending says is still drawable. Both
	the default and the ceiling are lending's: get_disbursal_amount decides what
	is available, validate_disbursal_amount rules on whatever is asked for, so
	neither number is computed here.
	"""
	user = _require_disbursement()

	decision = frappe.db.get_value(
		"Loan Application", application, ["gdb_reviewed_by", "gdb_owner"], as_dict=True
	)
	if decision and decision.gdb_reviewed_by == user:
		_logger().warning(f"four-eyes: {user} approved {application} and tried to release it")
		frappe.throw(
			_("You approved this application, so you cannot release its funds. "
			  "Another officer must disburse it."),
			frappe.PermissionError,
		)
	# The same principle one step further out: an officer must not pay
	# themselves, whatever roles they hold.
	if decision and decision.gdb_owner == user:
		frappe.throw(
			_("You cannot release funds on your own application."), frappe.PermissionError
		)

	loan = _booked_loan(application)
	if not loan:
		frappe.throw(_("No loan has been booked for {0} yet.").format(application))
	if loan.status not in ("Sanctioned", "Partially Disbursed"):
		frappe.throw(
			_("Loan {0} is not awaiting disbursement (status {1}).").format(loan.name, loan.status)
		)

	from lending.loan_management.doctype.loan_disbursement.loan_disbursement import (
		get_disbursal_amount,
	)


	# Conditions precedent are not advice. The Letter of Offer says no funds
	# move until they are met, so release checks the checklist rather than
	# trusting that somebody looked.
	from gdb_bank.conditions import outstanding

	blocking = outstanding(application)
	if blocking:
		frappe.throw(
			_("{0} condition(s) precedent are still outstanding: {1}").format(
				len(blocking), "; ".join(blocking[:3])
			)
		)

	with _as_system() as caller:
		amount = flt(amount) if amount else flt(get_disbursal_amount(loan.name)[0])
		if amount <= 0:
			frappe.throw(
				_("Nothing is available to disburse on {0} right now.").format(loan.name)
			)
		doc = frappe.get_doc(
			{
				"doctype": "Loan Disbursement",
				"against_loan": loan.name,
				"company": loan.company,
				"applicant_type": loan.applicant_type,
				"applicant": loan.applicant,
				"posting_date": nowdate(),
				"disbursement_date": nowdate(),
				"disbursed_amount": amount,
				"gdb_disbursed_by": caller,
			}
		)
		doc.insert()
		doc.submit()
		frappe.db.commit()

	_logger().info(f"disbursement {doc.name}: {amount} on {loan.name} by {user}")
	return loan_account(application)


# --------------------------------------------------------------------------
# Where the money goes — the citizen's own bank account
#
# GDB pays out through the commercial banks citizens already hold accounts
# with, so a disbursement needs a destination and the applicant is the only
# one who knows it. This is ERPNext's stock Bank Account doctype, linked to
# the citizen's Customer by party — the same record ERPNext's Payment Order
# reads when a payment run is assembled. No doctype of our own, and nothing
# here formats a payment file: this only captures the destination.
#
# Citizens hold no permission on Bank or Bank Account (deliberately — the
# generic REST surface would expose every other citizen's account), so the
# portal brokers both the list of banks and the write.
# --------------------------------------------------------------------------

BANK_ACCOUNT_FIELDS = [
	"name",
	"bank",
	"bank_account_no",
	"branch_code",
	"account_name",
	# The verification check, recorded the way plan.md 6.1 asks every external
	# check to be recorded: result, source, timestamp, reference.
	"gdb_verification_status",
	"gdb_verification_source",
	"gdb_verified_on",
	"gdb_verification_reference",
]


@frappe.whitelist()
def bank_options():
	"""Banks a citizen may nominate. Names only — nothing else is theirs to see."""
	_session_user()
	return frappe.get_all("Bank", fields=["name"], order_by="name asc", pluck="name")


@frappe.whitelist()
def my_bank_details():
	"""The nominated account for the logged-in citizen, or None."""
	user = _session_user()
	customer = frappe.db.get_value("Customer", {"gdb_user": user})
	if not customer:
		return None
	row = frappe.db.get_value(
		"Bank Account", {"party_type": "Customer", "party": customer}, BANK_ACCOUNT_FIELDS, as_dict=True
	)
	return row or None


@frappe.whitelist()
def save_bank_details(bank: str, bank_account_no: str, branch_code: str | None = None):
	"""Record (or update) where this citizen should be paid.

	One account per citizen: a second call replaces the first rather than
	adding another, so a payment run can never find two destinations for the
	same person and have to guess.
	"""
	user = _session_user()
	bank = (bank or "").strip()
	bank_account_no = (bank_account_no or "").strip()
	branch_code = (branch_code or "").strip()

	if not bank or not frappe.db.exists("Bank", bank):
		frappe.throw(_("Choose a bank from the list."))
	if not bank_account_no:
		frappe.throw(_("Account number is required."))
	if not bank_account_no.isdigit():
		frappe.throw(_("Account number should contain digits only."))

	customer = _get_or_create_customer(user)
	full_name = frappe.utils.get_fullname(user)

	# Check the account before recording it, whether it was picked from the
	# switch or typed. Advisory, never a gate: a bank holding a maiden name is
	# a case for an underwriter, not a dead end on an application form. What
	# this does guarantee is that nobody downstream has to wonder whether the
	# destination was ever checked — the answer, including "we could not tell",
	# is on the record.
	from gdb_bank.integrations import bank_registry

	check = bank_registry.verify(bank, bank_account_no, full_name)
	verification = {
		"gdb_verification_status": _check_result(check),
		"gdb_verification_source": check.get("source"),
		"gdb_verified_on": frappe.utils.now_datetime(),
		"gdb_verification_reference": check.get("reference") or check.get("account_name"),
	}

	# Writing a Bank Account is a bank-side operation; the citizen has no
	# permission on the doctype, and this endpoint has already established
	# that they are only ever touching their own.
	with _as_system():
		existing = frappe.db.get_value(
			"Bank Account", {"party_type": "Customer", "party": customer}, "name"
		)
		if existing:
			doc = frappe.get_doc("Bank Account", existing)
			doc.update(
				{
					"bank": bank,
					"bank_account_no": bank_account_no,
					"branch_code": branch_code,
					**verification,
				}
			)
			doc.save()
		else:
			# Named for the person, never "<name> — <bank>": a citizen may switch
			# banks, and ERPNext derives the record id from this at creation and
			# never revisits it. A label naming the old bank next to a field
			# naming the new one is how a payment gets misrouted.
			doc = frappe.get_doc(
				{
					"doctype": "Bank Account",
					"account_name": full_name,
					"bank": bank,
					"party_type": "Customer",
					"party": customer,
					"bank_account_no": bank_account_no,
					"branch_code": branch_code,
					"is_company_account": 0,
					**verification,
				}
			)
			doc.insert()
		frappe.db.commit()

	_logger().info(
		f"bank details saved for {user}: {bank} {bank_registry.mask(bank_account_no)} -> "
		f"{verification['gdb_verification_status']} ({verification['gdb_verification_source']})"
	)
	return frappe.db.get_value("Bank Account", doc.name, BANK_ACCOUNT_FIELDS, as_dict=True)


# --------------------------------------------------------------------------
# Is that account real, and is it theirs?
#
# A typed account number proves nothing: a transposed digit and a relative's
# account look identical on a form, and a payment instruction to either is
# money GDB does not get back. So the destination is discovered rather than
# typed — the national payment switch is asked which accounts the applicant's
# e-ID holds, and they pick one.
#
# Adapter: gdb_bank/integrations/bank_registry.py, contract in
# docs/integrations/bank-account-verification.md. Sandbox until the switch
# exists, and `source` says which answered on every result.
# --------------------------------------------------------------------------


def _check_result(result: dict) -> str:
	"""The recorded outcome of one account check.

	Five outcomes, not two. `Unavailable` is a state of its own and never
	becomes a pass (plan.md 6.1); `Inactive Account` means the account is real
	and the name matches and it still cannot receive funds.
	"""
	status = (result or {}).get("status")
	if status in (None, "Unavailable"):
		return "Unavailable"
	if status == "Not Found":
		return "Not Found"
	if result.get("name_match") is False:
		return "Name Mismatch"
	if status != "Active":
		return "Inactive Account"
	return "Verified"


@frappe.whitelist()
def my_bank_accounts():
	"""Accounts the national payment switch says this citizen holds.

	The portal fills the payout destination from this rather than asking for a
	number, so what reaches a payment run is a destination the switch already
	said is in the applicant's own name.

	Keyed on the e-ID bound to the *user*, not the session: identity.py writes
	gdb_eid on first e-ID sign-in and it persists, so a later email login
	searches just the same. A user who has never signed in with an e-ID has
	none, so there is nothing to search on and they get the manual path — which
	`verify_bank_account` then checks.
	"""
	user = _session_user()
	eid = frappe.db.get_value("User", user, "gdb_eid")
	if not eid:
		return []

	from gdb_bank.integrations import bank_registry

	found = bank_registry.accounts_for(eid, frappe.utils.get_fullname(user))
	# Only banks GDB can actually pay. An account at a bank with no Bank record
	# cannot be saved as a destination, so offering it is offering a dead end.
	known = set(frappe.get_all("Bank", pluck="name"))
	usable = [row for row in found if row.get("bank") in known]
	_logger().info(f"bank registry search for {user}: {len(found)} found, {len(usable)} payable")
	return usable


@frappe.whitelist()
def verify_bank_account(bank: str, bank_account_no: str):
	"""Check one account: does it exist, and is it in this person's name?

	For the manual path. The result is advisory here — it is recorded, shown,
	and never used to block an application, because a bank holding a maiden
	name is a case for a human, not a dead end on a form.
	"""
	user = _session_user()

	from gdb_bank.integrations import bank_registry

	result = bank_registry.verify(bank, bank_account_no, frappe.utils.get_fullname(user))
	result["result"] = _check_result(result)
	_logger().info(
		f"bank verify for {user}: {bank} {bank_registry.mask(bank_account_no)} -> "
		f"{result['result']} (source={result.get('source')})"
	)
	return result


# --------------------------------------------------------------------------
# DCRA — the applicant's registered business
#
# The Deeds and Commercial Registries Authority is where a Guyanese business
# is registered, so a DCRA number is the strongest evidence an underwriter has
# that a development loan is going to a real trading concern rather than a
# name on a form.
#
# There is no DCRA API wired up. `dcra_lookup` therefore answers from what GDB
# already knows — a returning applicant's own earlier filings — and returns
# `source` so the caller can tell a confirmed registry hit from a recalled
# one. When DCRA exposes a service, it slots in at the marked seam and the
# portal contract does not change.
# --------------------------------------------------------------------------


def _dcra_from_history(dcra_number: str, user: str | None = None) -> dict | None:
	"""The most recent application carrying this registration number."""
	filters = {"gdb_dcra_number": dcra_number}
	if user:
		filters["gdb_owner"] = user
	rows = frappe.get_all(
		"Loan Application",
		filters=filters,
		fields=["gdb_dcra_number", "gdb_business_name", "creation"],
		order_by="creation desc",
		limit=1,
	)
	return rows[0] if rows else None


@frappe.whitelist()
def dcra_lookup(dcra_number: str):
	"""Resolve a DCRA registration number to a business.

	The registry is the authority, so this asks DCRA first through the adapter
	in gdb_bank.integrations.dcra. GDB's own earlier filings are consulted only
	when the registry has nothing to say, and the reply always states which of
	the two answered so nothing recalled is mistaken for something verified.
	"""
	user = _session_user()
	from gdb_bank.integrations import dcra

	number = dcra.normalize(dcra_number)
	if not number:
		frappe.throw(_("Enter a DCRA registration number."))

	result = dcra.lookup(number)
	if result.get("business_name"):
		# A number that resolves is not the same as it being the caller's own —
		# say so rather than let a correct lookup read as confirmed ownership.
		eid = frappe.db.get_value("User", user, "gdb_eid")
		result["owned_by_caller"] = dcra.owned_by(result, eid) if eid else None
		_logger().info(f"dcra lookup {number} -> {result.get('source')} ({result.get('status')})")
		return result

	# Registry silent. Fall back to what this citizen told GDB before, clearly
	# labelled — a remembered name is a convenience, never evidence.
	row = _dcra_from_history(number, user=user)
	if row:
		return {
			"registration_number": number,
			"business_name": row.gdb_business_name,
			"status": result.get("status"),
			"source": "gdb_history",
			"last_seen": row.creation,
		}
	return result


@frappe.whitelist()
def my_businesses():
	"""Businesses DCRA says this applicant is a proprietor of.

	The applicant never types a registration number: they sign in as
	themselves, and the register says which businesses are theirs. That is
	both the convenience and the control — a business they do not own cannot
	appear in this list, so it cannot be claimed on an application. Matched
	on e-ID, not name: a name is free text that two registers can disagree on,
	the e-ID is the identifier this citizen actually signed in with. A citizen
	who has never signed in with an e-ID has none on file yet and gets no
	matches — the same "nothing found" fallback as anyone else.
	"""
	user = _session_user()
	from gdb_bank.integrations import dcra

	eid = frappe.db.get_value("User", user, "gdb_eid")
	found = dcra.businesses_for(eid) if eid else []
	_logger().info(f"dcra proprietor search for {user} (eid={eid}): {len(found)} business(es)")
	return found


@frappe.whitelist()
def my_business():
	"""The business this citizen last applied with, for prefilling the form."""
	user = _session_user()
	rows = frappe.get_all(
		"Loan Application",
		filters={"gdb_owner": user, "gdb_dcra_number": ["is", "set"]},
		fields=["gdb_dcra_number", "gdb_business_name", "creation"],
		order_by="creation desc",
		limit=1,
	)
	if not rows:
		return None
	return {
		"dcra_number": rows[0].gdb_dcra_number,
		"business_name": rows[0].gdb_business_name,
		"last_seen": rows[0].creation,
	}
