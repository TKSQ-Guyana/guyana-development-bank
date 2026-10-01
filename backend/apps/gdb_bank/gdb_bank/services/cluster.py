"""Clusters: applicants who share one plan and borrow as a group.

A GDB FACILITATOR forms the group, invites members by e-ID, names one accepted
member as its head, writes the shared plan and files the group's application in
the head's name (services/application.save_group_application). Citizens do
none of that: each invitee answers their own invitation, signed in as
themselves, and later signs the Letter of Offer. Only ACTIVE members count, and
`_clusters_of` is the one place that is decided. The head's application for the
group is shared with every active member; a member's own application stays
their own.

A cluster loan is never a side effect of membership, and never something a
citizen files: `_cluster_for` refuses any citizen who names a group.
"""

import frappe
from frappe import _
from frappe.utils import cint, nowdate

from gdb_bank.security.conflict import is_same_person
from gdb_bank.services.notification import notify
from gdb_bank.utils.constants import LOAN_FIELDS, PERSONAL_FINANCIAL_FIELDS, STATUS_TO_PORTAL
from gdb_bank.utils.eid import normalize_eid
from gdb_bank.utils.formatters import _for_viewer, _portal_dict
from gdb_bank.utils.session import _is_staff, _logger

# The portal route an invitation notification opens.
INVITATIONS_LINK = "/apply?view=clusters"

# Where a facilitator works on one group.
FACILITATOR_LINK = "/facilitator/groups/{0}"

# The seven questions of the shared plan. The doctype and the SPA use these keys.
PLAN_SECTIONS = (
	"plan_executive_summary",
	"plan_how_formed",
	"plan_governance",
	"plan_market",
	"plan_shared_project",
	"plan_operations",
	"plan_impact",
)

# What a group must have written before its application goes to the Bank.
REQUIRED_PLAN = ("plan_executive_summary", "plan_shared_project")


# --------------------------------------------------------------------------
# Membership rules
# --------------------------------------------------------------------------


def _clusters_of(user: str) -> list[str]:
	"""Every cluster this user has joined. An invitation is not membership."""
	return frappe.get_all(
		"GDB Cluster Member",
		filters={"member": user, "member_status": "Active"},
		pluck="parent",
	)


def _cluster_of(user: str) -> str | None:
	"""The first cluster joined — a default to offer, never a permission answer."""
	clusters = _clusters_of(user)
	return clusters[0] if clusters else None


def _cluster_for(user: str, cluster: str | None) -> str:
	"""The cluster a CITIZEN's own application is filed against: always "".

	A group's application is filed by its facilitator through
	save_group_application. Naming a group on your own draft is refused rather
	than ignored, so a client that still sends it learns why.
	"""
	if (cluster or "").strip():
		frappe.throw(
			_("Group applications are filed by the group's GDB facilitator."), frappe.PermissionError
		)
	return ""


def _is_shared_with(row, user: str) -> bool:
	"""True when `row` is the head's application for a cluster `user` has joined."""
	cluster = row.get("gdb_cluster")
	if not cluster or cluster not in _clusters_of(user):
		return False
	return frappe.db.get_value("GDB Cluster", cluster, "head") == row.get("gdb_owner")


def _require_facilitator_of(user: str, cluster: str | None) -> str:
	"""The group this facilitator runs, or a refusal. The facilitator's whole
	authority: the group, its roster, its plan and its application — never a
	decision, an offer or money."""
	cluster = (cluster or "").strip()
	if not cluster:
		frappe.throw(_("Say which group this is for."))
	if not frappe.db.exists("GDB Cluster", cluster):
		frappe.throw(_("Group {0} not found.").format(cluster), frappe.DoesNotExistError)
	if frappe.db.get_value("GDB Cluster", cluster, "facilitator") != user:
		frappe.throw(_("Only the group's facilitator may do this."), frappe.PermissionError)
	return cluster


def _inviter(cluster: str) -> str | None:
	"""Who an invitation is from: the facilitator, or the head of an older group."""
	row = frappe.db.get_value("GDB Cluster", cluster, ["facilitator", "head"], as_dict=True)
	return (row.facilitator or row.head) if row else None


def _notify_invited(user: str | None, cluster: str, inviter: str | None) -> None:
	notify(
		user,
		_("{0} invited you to join {1}").format(
			frappe.utils.get_fullname(inviter) if inviter else "GDB", cluster
		),
		INVITATIONS_LINK,
		from_user=inviter,
	)


def roster_split(cluster: str) -> dict:
	"""Who has actually joined, and who is still only invited.

	The two are never interchangeable where it counts: only an Active member
	sees the group's application (`_clusters_of`), and only an Active member is
	given a signature line when its offer is issued (`offers._roster_for`).
	"""
	rows = frappe.get_all(
		"GDB Cluster Member",
		filters={"parent": cluster},
		fields=["member", "member_eid", "member_name", "member_status", "is_head"],
		order_by="is_head desc, idx asc",
	)
	return {
		"active": [r for r in rows if r.member_status == "Active"],
		"invited": [r for r in rows if r.member_status == "Invited"],
	}


def notify_group_submitted(head: str, cluster: str, application: str, by: str | None = None) -> None:
	"""Tell the group that its application has gone to the Bank.

	The head is told it was filed in their name. An ACTIVE member can open the
	case, so their notification links to it; an INVITED one cannot, so theirs
	links to the invitation. Neither message carries an amount — a member may
	not see the head's income or contact details.
	"""
	sender = by or head
	if by:
		notify(
			head,
			_("{0}'s application was submitted to GDB in your name").format(cluster),
			f"/loans/{application}",
			from_user=sender,
		)
	split = roster_split(cluster)
	for row in split["active"]:
		if row.member and row.member != head:
			notify(
				row.member,
				_("{0}'s application has been submitted to GDB").format(cluster),
				f"/loans/{application}",
				from_user=sender,
			)
	for row in split["invited"]:
		if row.member:
			notify(
				row.member,
				_("{0}'s application was submitted — accept your invitation to see it").format(cluster),
				INVITATIONS_LINK,
				from_user=sender,
			)


# --------------------------------------------------------------------------
# The group and its roster (facilitator)
# --------------------------------------------------------------------------


def create_cluster(
	user: str,
	cluster_name: str,
	region: str | None = None,
	sector: str | None = None,
	group_purpose: str | None = None,
	locality: str | None = None,
	is_registered: str | None = None,
):
	"""A facilitator forms a group. It has no head until a member accepts and
	the facilitator names one (`set_head`). Names are unique."""
	cluster_name = (cluster_name or "").strip()
	if not cluster_name:
		frappe.throw(_("Group name is required."))
	if frappe.db.exists("GDB Cluster", cluster_name):
		frappe.throw(_("A group called {0} already exists.").format(cluster_name))

	doc = frappe.get_doc(
		{
			"doctype": "GDB Cluster",
			"cluster_name": cluster_name,
			"region": (region or "").strip(),
			"sector": (sector or "").strip(),
			"group_purpose": (group_purpose or "").strip(),
			"locality": (locality or "").strip(),
			"is_registered": (is_registered or "").strip(),
			"status": "Active",
			"facilitator": user,
			"facilitator_eid": frappe.db.get_value("User", user, "gdb_staff_eid"),
			"facilitator_name": frappe.utils.get_fullname(user),
			"members": [],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"cluster {doc.name} formed by facilitator {user}")
	return cluster_view(user, doc.name)


def invite_member(user: str, eid: str, full_name: str | None = None, cluster: str | None = None):
	"""The facilitator invites an e-ID. The invitee joins by accepting, and is
	notified.

	An e-ID with no account yet is a valid invitee: the row waits against the
	bare e-ID and `link_pending_invitations` attaches it on first sign-in. The
	facilitator can never invite themselves — by account or by the e-ID the
	platform admin recorded for them — because the head of a group must not be
	the person who prepared its case.
	"""
	cluster = _require_facilitator_of(user, cluster)
	eid = normalize_eid(eid)

	invitee = frappe.db.get_value("User", {"gdb_eid": eid}, "name")
	if eid == frappe.db.get_value("User", user, "gdb_staff_eid") or (
		invitee and is_same_person(user, invitee)
	):
		frappe.throw(_("You cannot invite yourself to a group you facilitate."), frappe.PermissionError)
	full_name = (full_name or "").strip() or (frappe.utils.get_fullname(invitee) if invitee else eid)

	doc = frappe.get_doc("GDB Cluster", cluster)
	row = next(
		(m for m in doc.members if m.member_eid == eid or (invitee and m.member == invitee)), None
	)
	if row and row.member_status in ("Invited", "Active"):
		frappe.throw(_("{0} is already in this group or invited to it.").format(eid))
	if row:
		# Declined or left before: ask again.
		row.update({"member_status": "Invited", "invited_on": nowdate(), "responded_on": None})
	else:
		doc.append(
			"members",
			{
				"member": invitee,
				"member_eid": eid,
				"member_name": full_name,
				"member_status": "Invited",
				"invited_on": nowdate(),
			},
		)
	doc.save(ignore_permissions=True)
	_notify_invited(invitee, cluster, user)
	frappe.db.commit()
	_logger().info(f"{user} invited {eid} to cluster {cluster} (user: {invitee or 'not yet'})")
	return cluster_view(user, cluster)


def _blocking_signature(cluster: str, member: str | None) -> str | None:
	"""A live offer this member still has to sign, if there is one.

	`offers._roster_for` freezes the signature roster when the offer is issued,
	so removing somebody who holds a PENDING line would leave an agreement
	nobody can complete. Removal waits until the offer is resolved.
	"""
	if not member:
		return None
	rows = frappe.get_all(
		"GDB Offer Signature",
		filters={"member": member, "signature_status": "Pending"},
		fields=["parent"],
	)
	for row in rows:
		offer = frappe.db.get_value(
			"GDB Loan Offer", row.parent, ["name", "status", "application"], as_dict=True
		)
		if offer and offer.status == "Issued":
			application = frappe.db.get_value("Loan Application", offer.application, "gdb_cluster")
			if application == cluster:
				return offer.name
	return None


def remove_member(
	user: str, eid: str | None = None, member: str | None = None, cluster: str | None = None
):
	"""The facilitator withdraws an invitation, or removes a member who joined.

	An INVITED row is DELETED: nobody joined, and leaving it as "Declined" would
	put an answer in the invitee's mouth they never gave. An ACTIVE row is
	marked EXITED and KEPT: they are part of the group's history, and anything
	they signed stays signed. The head cannot be removed — name another head
	first, which is only possible before the group has an application.
	"""
	cluster = _require_facilitator_of(user, cluster)
	eid = normalize_eid(eid) if eid else None
	if not eid and not member:
		frappe.throw(_("Say which member to remove."))

	doc = frappe.get_doc("GDB Cluster", cluster)
	row = next(
		(m for m in doc.members if (member and m.member == member) or (eid and m.member_eid == eid)),
		None,
	)
	if not row:
		frappe.throw(_("Nobody by that e-ID is in this group."))
	if cint(row.is_head) or (row.member and row.member == doc.head):
		frappe.throw(_("The head cannot be removed. Name another head first."))
	if row.member_status not in ("Invited", "Active"):
		frappe.throw(
			_("{0} is not in this group.").format(row.member_name or row.member_eid or row.member)
		)

	blocking = _blocking_signature(cluster, row.member)
	if blocking:
		frappe.throw(
			_("{0} still has to sign the Letter of Offer {1}. Resolve that offer first.").format(
				row.member_name or row.member_eid, blocking
			)
		)

	withdrawn = row.member_status == "Invited"
	who = row.member
	label = row.member_name or row.member_eid or row.member

	if withdrawn:
		doc.members.remove(row)
	else:
		row.member_status = "Exited"
		row.responded_on = nowdate()

	doc.save(ignore_permissions=True)
	notify(
		who,
		_("Your invitation to join {0} was withdrawn").format(cluster)
		if withdrawn
		else _("You are no longer part of {0}").format(cluster),
		INVITATIONS_LINK,
		from_user=user,
	)
	frappe.db.commit()
	_logger().info(
		f"{user} {'withdrew the invitation to' if withdrawn else 'removed'} {label} "
		f"from cluster {cluster}"
	)
	return cluster_view(user, cluster)


def set_head(user: str, cluster: str, eid: str):
	"""The facilitator names the head: the accepted member the group's
	application is filed for, and who borrows on the group's behalf.

	Only an ACTIVE member with an account — the head is a lending Customer, so
	somebody who has never signed in cannot be one. Fixed once the group has an
	application: its draft and its case are filed in the head's name, and moving
	the head under them would put a loan in somebody else's name.
	"""
	cluster = _require_facilitator_of(user, cluster)
	eid = normalize_eid(eid)
	doc = frappe.get_doc("GDB Cluster", cluster)
	row = next((m for m in doc.members if m.member_eid == eid), None)
	if not row or row.member_status != "Active" or not row.member:
		frappe.throw(_("The head must be a member who has accepted the invitation."))
	if row.member == doc.head:
		return cluster_view(user, cluster)
	if frappe.db.exists("Loan Application", {"gdb_cluster": cluster, "docstatus": ["<", 2]}):
		frappe.throw(_("The head cannot change once the group has an application."))
	if is_same_person(user, row.member):
		frappe.throw(_("You cannot be the head of a group you facilitate."), frappe.PermissionError)

	previous = doc.head
	for m in doc.members:
		m.is_head = 1 if m is row else 0
	doc.head = row.member
	doc.save(ignore_permissions=True)
	notify(
		row.member,
		_("You are now the head of {0}").format(cluster),
		INVITATIONS_LINK,
		from_user=user,
	)
	frappe.db.commit()
	_logger().info(f"{user} set head of cluster {cluster}: {previous or '(none)'} -> {row.member}")
	return cluster_view(user, cluster)


def my_invitations(user: str) -> list[dict]:
	"""Groups this person has been asked to join and has not yet answered."""
	eid = frappe.db.get_value("User", user, "gdb_eid")
	rows = frappe.get_all(
		"GDB Cluster Member",
		filters={"member": user, "member_status": "Invited"},
		fields=["parent", "invited_on"],
	)
	# Both sources, always — not one as a fallback for the other. A person can
	# hold an invitation already linked to their account AND one still raised
	# against their bare e-ID.
	if eid:
		seen = {row.parent for row in rows}
		rows += [
			row
			for row in frappe.get_all(
				"GDB Cluster Member",
				filters={"member_eid": eid, "member_status": "Invited"},
				fields=["parent", "invited_on"],
			)
			if row.parent not in seen
		]
	out = []
	for row in rows:
		cluster = frappe.db.get_value(
			"GDB Cluster", row.parent, ["name", "cluster_name", "region", "sector"], as_dict=True
		)
		if not cluster:
			continue
		inviter = _inviter(row.parent)
		cluster["invited_on"] = row.invited_on
		cluster["invited_by"] = frappe.utils.get_fullname(inviter) if inviter else None
		out.append(cluster)
	return out


def respond_to_invitation(user: str, cluster: str, accept=1):
	"""Accept or decline — the invitee's own act. `member` is stamped from the
	session, so a row can never be activated for somebody else. The facilitator
	is told either way."""
	accepting = bool(cint(accept))
	eid = frappe.db.get_value("User", user, "gdb_eid")

	doc = frappe.get_doc("GDB Cluster", cluster)
	row = next(
		(
			m
			for m in doc.members
			if m.member_status == "Invited" and (m.member == user or (eid and m.member_eid == eid))
		),
		None,
	)
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
	if doc.facilitator:
		notify(
			doc.facilitator,
			_("{0} {1} the invitation to {2}").format(
				frappe.utils.get_fullname(user), _("accepted") if accepting else _("declined"), cluster
			),
			FACILITATOR_LINK.format(cluster),
			from_user=user,
		)
	frappe.db.commit()
	_logger().info(f"{user} {'accepted' if accepting else 'declined'} the invitation to {cluster}")
	return cluster_view(user, cluster) if accepting else {"declined": cluster}


def link_pending_invitations(user: str, eid: str) -> int:
	"""On first e-ID sign-in: attach rows raised against the bare e-ID, and
	notify for each invitation still waiting. Called from identity.py."""
	rows = frappe.get_all(
		"GDB Cluster Member",
		filters={"member_eid": eid, "member": ["in", ["", None]]},
		fields=["name", "parent", "member_status"],
	)
	for row in rows:
		frappe.db.set_value(
			"GDB Cluster Member",
			row.name,
			{"member": user, "member_name": frappe.utils.get_fullname(user)},
			update_modified=False,
		)
		if row.member_status == "Invited":
			_notify_invited(user, row.parent, _inviter(row.parent))
	if rows:
		frappe.db.commit()
		_logger().info(f"linked {len(rows)} cluster invitation(s) for {eid} -> {user}")
	return len(rows)


def my_cluster(user: str):
	"""The caller's first cluster, or None. Kept for single-cluster callers."""
	cluster = _cluster_of(user)
	return cluster_view(user, cluster) if cluster else None


def my_clusters(user: str) -> list[dict]:
	"""Every cluster the caller is in, plus any they facilitate (no roster row)."""
	names = list(_clusters_of(user))
	for name in frappe.get_all(
		"GDB Cluster", filters={"facilitator": user}, pluck="name", order_by="modified desc"
	):
		if name not in names:
			names.append(name)
	return [cluster_view(user, name) for name in names]


def cluster_view(user: str, cluster: str) -> dict:
	"""Plan, roster and the applications raised under a cluster.

	Invited members may read it, to decide whether to join. A member's own
	application shows to other members only as a name and a status; staff see
	everything, including each member's profile. The facilitator sees the
	group's own application without the head's contact details or income.
	"""
	doc = frappe.get_doc("GDB Cluster", cluster)
	roster = [m.as_dict() for m in doc.members]
	members = {m.member for m in roster if m.member}
	staff = _is_staff(user)
	facilitator = bool(doc.facilitator) and doc.facilitator == user
	if not (staff or user in members or facilitator):
		frappe.throw(_("You are not a member of this cluster."), frappe.PermissionError)

	cases = []
	for row in frappe.get_all(
		"Loan Application",
		filters={"gdb_cluster": cluster, "docstatus": ["<", 2]},
		fields=LOAN_FIELDS,
		order_by="creation asc",
	):
		shared = bool(doc.head) and row.gdb_owner == doc.head
		if shared or row.gdb_owner == user or staff:
			cases.append(dict(_for_viewer(_portal_dict(row), user), shared=shared, private=False))
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

	profiles = {}
	if staff:
		for row in frappe.get_all(
			"GDB Citizen Profile",
			filters={"user": ["in", list(members) or [""]]},
			fields=[
				"user",
				"phone",
				"region",
				"village_or_town",
				"occupation",
				"verified_phone",
				*PERSONAL_FINANCIAL_FIELDS,
				"financials_updated_on",
			],
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
		"is_head": bool(doc.head) and doc.head == user,
		"is_facilitator": facilitator,
		"can_edit_plan": facilitator,
		"viewer": user,
		"members": [
			{
				"member": m.member,
				"member_eid": m.member_eid,
				"member_name": m.member_name,
				"member_status": m.member_status,
				"is_head": bool(m.is_head),
				"is_you": m.member == user,
				"invited_on": m.invited_on,
				"joined_on": m.joined_on,
				"profile": profiles.get(m.member) if staff else None,
			}
			for m in roster
		],
		# Neither count includes the head. Counted here so the portal and the
		# rules that act on it (`_clusters_of`, `offers._roster_for`) read the
		# same number.
		"joined_count": len([m for m in roster if m.member_status == "Active" and not m.is_head]),
		"invited_count": len([m for m in roster if m.member_status == "Invited"]),
		"applications": cases,
	}


# --------------------------------------------------------------------------
# The shared plan and the group's details (facilitator)
# --------------------------------------------------------------------------


def _frozen(cluster: str) -> None:
	"""The plan and details an underwriter is reading do not change under them."""
	if frappe.db.exists("Loan Application", {"gdb_cluster": cluster, "docstatus": 1}):
		frappe.throw(_("The group's application is with GDB. Its plan and details are locked."))


def save_cluster_plan(user: str, cluster: str, sections: dict):
	"""Write the plan sections passed, and only those. Anything outside
	PLAN_SECTIONS is ignored."""
	cluster = _require_facilitator_of(user, cluster)
	_frozen(cluster)

	doc = frappe.get_doc("GDB Cluster", cluster)
	written = [field for field in PLAN_SECTIONS if sections.get(field) is not None]
	for field in written:
		doc.set(field, (sections[field] or "").strip())
	if written:
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		_logger().info(f"{user} wrote {len(written)} plan section(s) on cluster {cluster}")
	return cluster_view(user, cluster)


def save_cluster_details(
	user: str,
	cluster: str,
	region: str | None = None,
	sector: str | None = None,
	group_purpose: str | None = None,
	locality: str | None = None,
	is_registered: str | None = None,
):
	"""The group's own description. Only the fields passed are written."""
	cluster = _require_facilitator_of(user, cluster)
	_frozen(cluster)

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
	return cluster_view(user, cluster)


# --------------------------------------------------------------------------
# e-ID lookup
# --------------------------------------------------------------------------


def lookup_eid(user: str, eid: str) -> dict:
	"""A name for an e-ID that holds an account — nothing else about them."""
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
