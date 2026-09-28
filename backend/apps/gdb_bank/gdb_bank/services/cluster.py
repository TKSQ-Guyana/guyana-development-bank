"""Clusters: applicants who share one plan and borrow as a group.

The head creates the group and invites members by e-ID; each invitee answers,
signed in as themselves. Only ACTIVE members count, and `_clusters_of` is the
one place that is decided. The head's application for the group is shared with
every active member; a member's own application stays their own.

A cluster loan is never a side effect of membership: an application is filed
against a group only when its head names it (`_cluster_for`).
"""

import frappe
from frappe import _
from frappe.utils import cint, nowdate

from gdb_bank.services.notification import notify
from gdb_bank.utils.constants import LOAN_FIELDS, PERSONAL_FINANCIAL_FIELDS, STATUS_TO_PORTAL
from gdb_bank.utils.eid import normalize_eid
from gdb_bank.utils.formatters import _for_viewer, _portal_dict
from gdb_bank.utils.session import _is_staff, _logger

# The portal route an invitation notification opens.
INVITATIONS_LINK = "/apply?view=clusters"

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

# PLACEHOLDER. GDB has appointed no facilitators yet, so these are invented
# names on real e-IDs. To go live: return the Users holding a Facilitator role,
# filtered by region — the e-ID shape handed back already matches.
FACILITATOR_ROSTER = (
	{"eid": "592-6666-0006", "full_name": "Rani Singh", "region": "Region 2 — Pomeroon-Supenaam"},
	{"eid": "592-7777-0007", "full_name": "Devon Baksh", "region": "Region 3 — Essequibo Islands-West Demerara"},
	{"eid": "592-8888-0008", "full_name": "Marcia Khan", "region": "Region 4 — Demerara-Mahaica"},
	{"eid": "592-1010-0010", "full_name": "Anita Ramkissoon", "region": "Region 6 — East Berbice-Corentyne"},
	{"eid": "592-1122-0011", "full_name": "Trevor Adams", "region": "Region 9 — Upper Takutu-Upper Essequibo"},
	{"eid": "592-1133-0012", "full_name": "Shanta Narine", "region": "Region 10 — Upper Demerara-Berbice"},
)


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
	"""The cluster an application is filed against: "" unless its head names one."""
	cluster = (cluster or "").strip()
	if not cluster:
		return ""
	if cluster not in _clusters_of(user):
		frappe.throw(_("You are not a member of cluster {0}.").format(cluster), frappe.PermissionError)
	_require_head(user, cluster)
	return cluster


def _is_shared_with(row, user: str) -> bool:
	"""True when `row` is the head's application for a cluster `user` has joined."""
	cluster = row.get("gdb_cluster")
	if not cluster or cluster not in _clusters_of(user):
		return False
	return frappe.db.get_value("GDB Cluster", cluster, "head") == row.get("gdb_owner")


def _require_head(user: str, cluster: str) -> None:
	if frappe.db.get_value("GDB Cluster", cluster, "head") != user:
		frappe.throw(_("Only the cluster head may do this."), frappe.PermissionError)


def _head_cluster(user: str, cluster: str | None) -> str:
	"""The cluster the caller acts as head of: the one named, or their only one."""
	cluster = (cluster or "").strip()
	joined = _clusters_of(user)
	if not cluster:
		if not joined:
			frappe.throw(_("You are not in a cluster."))
		if len(joined) > 1:
			frappe.throw(_("Say which cluster this is for."))
		cluster = joined[0]
	elif cluster not in joined:
		frappe.throw(_("You are not a member of cluster {0}.").format(cluster), frappe.PermissionError)
	_require_head(user, cluster)
	return cluster


def _require_shared_editor(user: str, cluster: str) -> None:
	"""The shared plan is written by the head or the facilitator — nobody else.

	This is the whole of a facilitator's authority; nothing near an application,
	decision or offer calls it.
	"""
	row = frappe.db.get_value("GDB Cluster", cluster, ["head", "facilitator"], as_dict=True)
	if not row:
		frappe.throw(_("Cluster {0} not found.").format(cluster))
	if user not in (row.head, row.facilitator):
		frappe.throw(
			_("Only the cluster head or its facilitator may edit the shared plan."),
			frappe.PermissionError,
		)


def _notify_invited(user: str | None, cluster: str, head: str) -> None:
	notify(
		user,
		_("{0} invited you to join {1}").format(frappe.utils.get_fullname(head), cluster),
		INVITATIONS_LINK,
		from_user=head,
	)


# --------------------------------------------------------------------------
# The group and its roster
# --------------------------------------------------------------------------


def create_cluster(
	user: str,
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
	"""A citizen starts a group and becomes its head. Names are unique."""
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

	# After the insert, so an unusable facilitator e-ID costs the facilitator,
	# not the group.
	if cint(facilitator_requested) or (facilitator_eid or "").strip():
		attach_facilitator(user, doc.name, facilitator_eid, requested=1)

	return cluster_view(user, doc.name)


def invite_member(user: str, eid: str, full_name: str | None = None, cluster: str | None = None):
	"""The head invites an e-ID. The invitee joins by accepting, and is notified.

	An e-ID with no account yet is a valid invitee: the row waits against the
	bare e-ID and `link_pending_invitations` attaches it on first sign-in.
	"""
	cluster = _head_cluster(user, cluster)
	eid = normalize_eid(eid)

	invitee = frappe.db.get_value("User", {"gdb_eid": eid}, "name")
	if invitee == user:
		frappe.throw(_("You are already the head of this cluster."))
	full_name = (full_name or "").strip() or (frappe.utils.get_fullname(invitee) if invitee else eid)

	doc = frappe.get_doc("GDB Cluster", cluster)
	row = next(
		(m for m in doc.members if m.member_eid == eid or (invitee and m.member == invitee)), None
	)
	if row and row.member_status in ("Invited", "Active"):
		frappe.throw(_("{0} has already been invited to this cluster.").format(eid))
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


def my_invitations(user: str) -> list[dict]:
	"""Groups this person has been asked to join and has not yet answered."""
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


def respond_to_invitation(user: str, cluster: str, accept=1):
	"""Accept or decline — the invitee's own act. `member` is stamped from the
	session, so a row can never be activated for somebody else."""
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
			_notify_invited(user, row.parent, frappe.db.get_value("GDB Cluster", row.parent, "head"))
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
	for name in frappe.get_all("GDB Cluster", filters={"facilitator": user}, pluck="name"):
		if name not in names:
			names.append(name)
	return [cluster_view(user, name) for name in names]


def cluster_view(user: str, cluster: str) -> dict:
	"""Plan, roster and the applications raised under a cluster.

	Invited members may read it, to decide whether to join. A member's own
	application shows to other members only as a name and a status; staff see
	everything, including each member's profile.
	"""
	doc = frappe.get_doc("GDB Cluster", cluster)
	roster = [m.as_dict() for m in doc.members]
	members = {m.member for m in roster if m.member}
	staff = _is_staff(user)
	if not (staff or user in members or user == doc.facilitator):
		frappe.throw(_("You are not a member of this cluster."), frappe.PermissionError)

	cases = []
	for row in frappe.get_all(
		"Loan Application", filters={"gdb_cluster": cluster}, fields=LOAN_FIELDS, order_by="creation asc"
	):
		shared = row.gdb_owner == doc.head
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
		"is_head": doc.head == user,
		"is_facilitator": bool(doc.facilitator) and doc.facilitator == user,
		"can_edit_plan": user in (doc.head, doc.facilitator),
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
		"applications": cases,
	}


# --------------------------------------------------------------------------
# The shared plan and the group's details (head or facilitator)
# --------------------------------------------------------------------------


def save_plan(
	user: str, loan_purpose: str | None = None, business_plan: str | None = None, cluster: str | None = None
):
	"""The head edits the shared purpose and the legacy free-text plan."""
	cluster = _head_cluster(user, cluster)
	doc = frappe.get_doc("GDB Cluster", cluster)
	if loan_purpose is not None:
		doc.loan_purpose = loan_purpose.strip()
	if business_plan is not None:
		doc.business_plan = business_plan.strip()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return cluster_view(user, cluster)


def save_cluster_plan(user: str, cluster: str, sections: dict):
	"""Write the plan sections passed, and only those — two editors never blank
	each other's work. Anything outside PLAN_SECTIONS is ignored."""
	cluster = (cluster or "").strip()
	if not cluster:
		frappe.throw(_("Say which cluster this plan is for."))
	_require_shared_editor(user, cluster)

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
	return cluster_view(user, cluster)


# --------------------------------------------------------------------------
# Facilitators and e-ID lookup
# --------------------------------------------------------------------------


def facilitators(region: str | None = None) -> list[dict]:
	"""The facilitators a group may ask for. `region` sorts, it does not filter."""
	region = (region or "").strip()
	rows = [dict(row, placeholder=True) for row in FACILITATOR_ROSTER]
	if region:
		rows.sort(key=lambda r: r["region"] != region)
	return rows


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


def attach_facilitator(user: str, cluster: str, eid: str | None = None, requested: int | None = None):
	"""Name the facilitator by e-ID (linked on their first sign-in), or clear it.

	Grants nothing beyond the shared plan — see `_require_shared_editor`.
	"""
	cluster = _head_cluster(user, cluster)
	doc = frappe.get_doc("GDB Cluster", cluster)

	eid = (eid or "").strip()
	if not eid:
		doc.facilitator = None
		doc.facilitator_eid = None
		doc.facilitator_name = None
		doc.facilitator_requested = cint(requested)
	else:
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
	return cluster_view(user, cluster)


def link_pending_facilitator(user: str, eid: str) -> int:
	"""On first e-ID sign-in: attach clusters that named this e-ID as facilitator."""
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
