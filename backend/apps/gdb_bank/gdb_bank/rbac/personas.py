"""THE PERSONA REGISTRY - the one file you edit to add or change a role.

Everything downstream is derived from `PERSONAS`: the Frappe Roles and Role
Profiles that get created, the DocType permission rows, the row-level scoping
of every query, the capability set the SPA renders its navigation from, and the
Keycloak claim -> Frappe role mapping.

--------------------------------------------------------------------------
ADDING A ROLE  (e.g. a "Recovery Officer" persona, six months from now)
--------------------------------------------------------------------------
    1. Add any new capability constants to `capabilities.py`.
    2. Append one `PersonaSpec(...)` below. Give it a NEW `key` and `role`.
    3. If it must never act as checker on its own maker step, add a
       `SeparationRule` in `separation.py`.
    4. `bench migrate` (or restart the stack). `provisioning.reconcile()` runs
       on `after_migrate` and creates the Role, the Role Profile and the
       DocType permissions. No code changes anywhere else.

--------------------------------------------------------------------------
MODIFYING A ROLE
--------------------------------------------------------------------------
    Edit its spec and bump `revision`. `reconcile()` is convergent: it adds
    what is missing and strips DocType permission rows this app previously
    granted but the registry no longer declares. It never touches permission
    rows created outside `gdb_bank`.

--------------------------------------------------------------------------
RETIRING A ROLE
--------------------------------------------------------------------------
    Set `retired=True` rather than deleting the spec. Reconcile then revokes
    its DocType permissions and disables the Role, but leaves the Role record
    and every historical audit row that names it intact - audit trails must
    stay readable after a persona is withdrawn.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from gdb_bank.rbac import capabilities as cap


class RowScope(str, Enum):
	"""How far a persona's reads reach. Enforced in `repositories/`, applied to
	every list query and every single-document fetch - not advisory."""

	NONE = "none"
	"""No row access at all. Aggregate endpoints only - this is the Board/CEO
	guarantee from Phase 5, and it is a hard denial, not a hidden menu item."""

	OWN_EID = "own_eid"
	"""Only rows whose subject EID equals the session EID."""

	FACILITATED = "facilitated"
	"""OWN_EID, plus rows bound to this user's EID as `facilitator_eid`."""

	ALL = "all"
	"""Every row. Case-level PII is visible."""


@dataclass(frozen=True)
class DocPerm:
	"""One row of a DocType's Permissions table, declared as data.

	Every column Frappe's `Custom DocPerm` carries is named explicitly and
	defaults to denied. `export`/`import`/`share` stay off unless a persona is
	given them on purpose: each is a route by which case-level PII leaves the
	system, and an unset field that silently defaults to 1 is how that happens.
	"""

	doctype: str
	read: bool = False
	write: bool = False
	create: bool = False
	delete: bool = False
	submit: bool = False
	cancel: bool = False
	amend: bool = False
	report: bool = False
	select: bool = False
	print_: bool = False
	email: bool = False
	export: bool = False
	share: bool = False
	set_user_permissions: bool = False
	permlevel: int = 0
	if_owner: bool = False

	def as_perm_fields(self) -> dict:
		"""The Custom DocPerm field set. `import` is deliberately absent: no GDB
		persona may bulk-import into a case-level DocType."""
		return {
			"permlevel": self.permlevel,
			"read": int(self.read),
			"write": int(self.write),
			"create": int(self.create),
			"delete": int(self.delete),
			"submit": int(self.submit),
			"cancel": int(self.cancel),
			"amend": int(self.amend),
			"report": int(self.report),
			"select": int(self.select or self.read),
			"print": int(self.print_),
			"email": int(self.email),
			"export": int(self.export),
			"share": int(self.share),
			"set_user_permissions": int(self.set_user_permissions),
			"if_owner": int(self.if_owner),
		}


@dataclass(frozen=True)
class PersonaSpec:
	key: str
	"""Stable machine key. Persisted in audit rows - never rename."""

	role: str
	"""The Frappe Role name. Frappe's Permission Manager is the enforcement
	engine (CLAUDE.md section 4); this registry only declares what it holds."""

	title: str
	description: str

	capabilities: frozenset[str]
	row_scope: RowScope

	desk_access: bool = False
	"""System User (ERPNext desk) vs Website User. Citizens and Facilitators are
	website users: they never see the desk."""

	keycloak_roles: tuple[str, ...] = ()
	"""Realm roles in the Guyana-Gov Keycloak realm that map onto this persona.
	A token carrying any of them grants this Frappe role at login. Several
	claims may map to one persona; one claim may map to several personas."""

	doctype_permissions: tuple[DocPerm, ...] = ()

	portal_home: str = "/"
	"""Where the SPA lands this persona after login. The SPA reads this from
	`whoami` rather than hardcoding a role->route switch."""

	role_profile: str | None = None
	"""Frappe Role Profile bundling this role plus `bundled_roles`."""

	bundled_roles: tuple[str, ...] = ()
	"""Extra pre-existing Frappe roles this persona also needs (e.g. lending's
	"Loan Manager" so GDB staff can use the ERPNext Lending workspace)."""

	revision: int = 1
	"""Bump when you change a spec. Recorded on the Role so an operator can see
	at a glance whether a deployed realm is behind the code."""

	retired: bool = False

	def __post_init__(self) -> None:
		unknown = set(self.capabilities) - cap.ALL_CAPABILITIES
		if unknown:
			raise ValueError(
				f"persona {self.key!r} declares unknown capabilities: {sorted(unknown)}"
			)

	@property
	def profile_name(self) -> str:
		return self.role_profile or f"GDB {self.title}"


# ---------------------------------------------------------------------------
# DocType names - single place to spell them.
# ---------------------------------------------------------------------------

APPLICATION = "GDB Loan Application"
DOCUMENT = "GDB Application Document"
AUDIT_EVENT = "GDB Audit Event"
CONDITION = "GDB Disbursement Condition"
RULE_CHANGE = "GDB Lending Rule Change"
CLUSTER = "GDB Cluster"
CONSENT = "GDB Consent"
MANDATE = "GDB Facilitator Mandate"
INFO_REQUEST = "GDB Information Request"

CASE_LEVEL_DOCTYPES: frozenset[str] = frozenset(
	{APPLICATION, DOCUMENT, CONSENT, CLUSTER, MANDATE, INFO_REQUEST, CONDITION}
)
"""DocTypes that carry applicant PII. A persona with `RowScope.NONE` must never
hold a permission row on any of these; `provisioning` asserts it on migrate."""


def _read_only(*doctypes: str) -> tuple[DocPerm, ...]:
	return tuple(DocPerm(doctype=d, read=True, report=True) for d in doctypes)


# ---------------------------------------------------------------------------
# THE REGISTRY
# ---------------------------------------------------------------------------

PERSONAS: tuple[PersonaSpec, ...] = (
	PersonaSpec(
		key="citizen",
		role="GDB Citizen",
		title="Citizen",
		description="Applicant or borrower. Sees only their own case.",
		desk_access=False,
		row_scope=RowScope.OWN_EID,
		portal_home="/",
		keycloak_roles=("Citizen", "GDB_Citizen"),
		capabilities=frozenset(
			{
				cap.IDENTITY_VIEW_SELF,
				cap.IDENTITY_GIVE_CONSENT,
				cap.IDENTITY_VIEW_GOVERNMENT_RECORD,
				cap.APPLICATION_CREATE,
				cap.APPLICATION_EDIT_DRAFT,
				cap.APPLICATION_SUBMIT,
				cap.APPLICATION_VIEW_OWN,
				cap.APPLICATION_RESPOND_TO_INFO_REQUEST,
				cap.DOCUMENT_UPLOAD_OWN,
				cap.DOCUMENT_VIEW_OWN,
				cap.OFFER_ACCEPT,
				cap.CONDITION_VIEW,
				cap.CONDITION_COMPLETE_OWN,
				cap.DISBURSEMENT_CONFIRM_RECEIPT,
				cap.REPAYMENT_VIEW_OWN_SCHEDULE,
				cap.REPAYMENT_PAY,
				cap.REPAYMENT_REQUEST_STATEMENT,
				cap.CLUSTER_CREATE,
				cap.CLUSTER_INVITE_MEMBER,
				cap.CLUSTER_ACCEPT_INVITE,
				cap.CLUSTER_VIEW_MEMBERS,
				cap.CLUSTER_GRANT_FACILITATOR_MANDATE,
			}
		),
		doctype_permissions=(
			DocPerm(APPLICATION, read=True, write=True, create=True, submit=True, if_owner=True),
			DocPerm(DOCUMENT, read=True, write=True, create=True, if_owner=True),
			DocPerm(CONSENT, read=True, create=True, if_owner=True),
			DocPerm(CLUSTER, read=True, write=True, create=True, if_owner=True),
			DocPerm(MANDATE, read=True, create=True, if_owner=True),
			DocPerm(CONDITION, read=True),
			DocPerm(INFO_REQUEST, read=True, write=True),
		),
	),
	PersonaSpec(
		key="facilitator",
		role="GDB Regional Facilitator",
		title="Regional Facilitator",
		description=(
			"Drafts and submits on behalf of a cluster that has explicitly "
			"mandated them. Never becomes the owner of the application."
		),
		desk_access=False,
		row_scope=RowScope.FACILITATED,
		portal_home="/facilitator",
		keycloak_roles=("GDB_Regional_Facilitator",),
		capabilities=frozenset(
			{
				cap.IDENTITY_VIEW_SELF,
				cap.APPLICATION_DRAFT_ON_BEHALF,
				cap.APPLICATION_SUBMIT_ON_BEHALF,
				cap.APPLICATION_VIEW_FACILITATED,
				cap.APPLICATION_EDIT_DRAFT,
				cap.DOCUMENT_UPLOAD_ON_BEHALF,
				cap.CLUSTER_VIEW_MEMBERS,
				cap.CONDITION_VIEW,
			}
		),
		doctype_permissions=(
			DocPerm(APPLICATION, read=True, write=True, create=True, submit=True),
			DocPerm(DOCUMENT, read=True, write=True, create=True),
			DocPerm(MANDATE, read=True),
			DocPerm(CLUSTER, read=True),
		),
	),
	PersonaSpec(
		key="underwriter",
		role="GDB Underwriter",
		title="Underwriter",
		description=(
			"Credit decision maker. Cannot release money, verify conditions, "
			"change a lending rule, or review their own application."
		),
		desk_access=True,
		row_scope=RowScope.ALL,
		portal_home="/underwriting",
		keycloak_roles=("GDB_Underwriter",),
		bundled_roles=("Loan Manager",),
		capabilities=frozenset(
			{
				cap.IDENTITY_VIEW_SELF,
				cap.APPLICATION_VIEW_QUEUE,
				cap.APPLICATION_VIEW_ANY,
				cap.APPLICATION_REQUEST_INFO,
				cap.DOCUMENT_VIEW_ANY,
				cap.VERIFICATION_VIEW_COMPARISON,
				cap.CREDIT_APPROVE,
				cap.CREDIT_DECLINE,
				cap.OFFER_ISSUE,
				cap.LOAN_BOOK,
				cap.DECISION_VIEW_OWN_HISTORY,
				cap.CONDITION_VIEW,
				cap.RULE_VIEW_HISTORY,
			}
		),
		doctype_permissions=(
			DocPerm(APPLICATION, read=True, write=True, submit=True, report=True),
			DocPerm(DOCUMENT, read=True, report=True),
			DocPerm(INFO_REQUEST, read=True, write=True, create=True),
			*_read_only(AUDIT_EVENT, CONDITION, RULE_CHANGE, CONSENT),
		),
	),
	PersonaSpec(
		key="disbursement_officer",
		role="GDB Disbursement Officer",
		title="Disbursement Officer",
		description=(
			"Verifies conditions, countersigns, releases funds. Cannot decide "
			"credit, and cannot release a loan they approved or are party to."
		),
		desk_access=True,
		row_scope=RowScope.ALL,
		portal_home="/disbursement",
		keycloak_roles=("GDB_Disbursement_Officer",),
		bundled_roles=("Loan Manager",),
		capabilities=frozenset(
			{
				cap.IDENTITY_VIEW_SELF,
				cap.APPLICATION_VIEW_ANY,
				cap.DOCUMENT_VIEW_ANY,
				cap.CONDITION_VIEW,
				cap.CONDITION_VERIFY,
				cap.OFFER_COUNTERSIGN,
				cap.DISBURSEMENT_VIEW_QUEUE,
				cap.DISBURSEMENT_RELEASE,
				cap.DISBURSEMENT_EXPORT_PAYMENT_FILE,
				cap.DISBURSEMENT_RECORD_OUTCOME,
				cap.DISBURSEMENT_RECORD_EXCEPTION,
				cap.RULE_VIEW_HISTORY,
			}
		),
		doctype_permissions=(
			DocPerm(APPLICATION, read=True, write=True, report=True),
			DocPerm(DOCUMENT, read=True, report=True),
			DocPerm(CONDITION, read=True, write=True, create=True, report=True),
			*_read_only(AUDIT_EVENT, RULE_CHANGE),
		),
	),
	PersonaSpec(
		key="finance",
		role="GDB Finance Officer",
		title="Finance Officer",
		description=(
			"Ledger, reconciliation, refunds, portfolio reporting down to the "
			"case. Proposes lending rule changes but never approves their own."
		),
		desk_access=True,
		row_scope=RowScope.ALL,
		portal_home="/finance",
		keycloak_roles=("GDB_Finance_Officer",),
		bundled_roles=("Accounts User", "Loan Manager"),
		capabilities=frozenset(
			{
				cap.IDENTITY_VIEW_SELF,
				cap.APPLICATION_VIEW_ANY,
				cap.FINANCE_VIEW_LEDGER,
				cap.FINANCE_RECONCILE,
				cap.FINANCE_REFUND,
				cap.FINANCE_PORTFOLIO_DETAIL,
				cap.RULE_PROPOSE,
				cap.RULE_VIEW_HISTORY,
				cap.REPORT_PORTFOLIO_AGGREGATE,
				cap.REPORT_ARREARS_AGGREGATE,
				cap.REPORT_TRENDS_AGGREGATE,
			}
		),
		doctype_permissions=(
			DocPerm(APPLICATION, read=True, report=True),
			DocPerm(RULE_CHANGE, read=True, write=True, create=True, submit=True, report=True),
			*_read_only(AUDIT_EVENT, CONDITION),
		),
	),
	PersonaSpec(
		key="board",
		role="GDB Board Member",
		title="Board / CEO",
		description=(
			"Aggregate reporting and rule approval. Has NO read permission on "
			"any case-level DocType - Phase 5's privacy guarantee is the absence "
			"of a DocPerm row, not a hidden route."
		),
		desk_access=True,
		row_scope=RowScope.NONE,
		portal_home="/board",
		keycloak_roles=("GDB_Board_Member", "GDB_CEO"),
		capabilities=frozenset(
			{
				cap.IDENTITY_VIEW_SELF,
				cap.REPORT_PORTFOLIO_AGGREGATE,
				cap.REPORT_ARREARS_AGGREGATE,
				cap.REPORT_TRENDS_AGGREGATE,
				cap.RULE_APPROVE,
				cap.RULE_VIEW_HISTORY,
			}
		),
		# Deliberately NO permission on any CASE_LEVEL_DOCTYPES. Do not add one -
		# provisioning.reconcile() raises if you do.
		doctype_permissions=(
			DocPerm(RULE_CHANGE, read=True, write=True, submit=True, report=True),
		),
	),
	PersonaSpec(
		key="platform_admin",
		role="GDB Platform Admin",
		title="Platform Admin",
		description=(
			"User and role administration, the kill switch, system health and "
			"integration settings. By policy: no credit decisions, no money."
		),
		desk_access=True,
		row_scope=RowScope.NONE,
		portal_home="/admin",
		keycloak_roles=("GDB_Platform_Admin",),
		capabilities=frozenset(
			{
				cap.IDENTITY_VIEW_SELF,
				cap.ADMIN_MANAGE_USERS,
				cap.ADMIN_GRANT_ROLES,
				cap.ADMIN_DISABLE_USER,
				cap.ADMIN_VIEW_SYSTEM_HEALTH,
				cap.ADMIN_MANAGE_INTEGRATIONS,
				cap.RULE_VIEW_HISTORY,
			}
		),
		doctype_permissions=_read_only(AUDIT_EVENT, RULE_CHANGE),
	),
)


# ---------------------------------------------------------------------------
# Compatibility + retirement
# ---------------------------------------------------------------------------

LEGACY_ROLE_ALIASES: dict[str, str] = {
	# The pre-registry build shipped these. Users still carrying them keep
	# working; `provisioning.reconcile()` migrates them onto the new roles.
	"Citizen": "GDB Citizen",
	"Loan Underwriter": "GDB Underwriter",
}

RETIRED_CAPABILITIES: frozenset[str] = frozenset()
"""Capability strings no persona holds any more. Kept so audit rows that name
them still resolve to a label instead of rendering as a raw key."""


# ---------------------------------------------------------------------------
# Derived lookups - built once at import, never mutated.
# ---------------------------------------------------------------------------

ACTIVE_PERSONAS: tuple[PersonaSpec, ...] = tuple(p for p in PERSONAS if not p.retired)

BY_KEY: dict[str, PersonaSpec] = {p.key: p for p in PERSONAS}
BY_ROLE: dict[str, PersonaSpec] = {p.role: p for p in PERSONAS}

_ROW_SCOPE_RANK = {
	RowScope.NONE: 0,
	RowScope.OWN_EID: 1,
	RowScope.FACILITATED: 2,
	RowScope.ALL: 3,
}


def keycloak_role_map() -> dict[str, tuple[str, ...]]:
	"""Keycloak realm role -> the Frappe roles it grants. Several personas may
	claim the same realm role; all of them are granted."""
	mapping: dict[str, list[str]] = {}
	for persona in ACTIVE_PERSONAS:
		for kc_role in persona.keycloak_roles:
			mapping.setdefault(kc_role, []).append(persona.role)
	return {k: tuple(v) for k, v in mapping.items()}


def resolve_roles(roles) -> set[str]:
	"""Map legacy role names onto their current equivalents."""
	return {LEGACY_ROLE_ALIASES.get(r, r) for r in roles}


def personas_for_roles(roles) -> tuple[PersonaSpec, ...]:
	resolved = resolve_roles(roles)
	return tuple(p for p in ACTIVE_PERSONAS if p.role in resolved)


def capabilities_for_roles(roles) -> frozenset[str]:
	"""Union of the capabilities of every persona the user holds. A user with
	two personas gets both capability sets - separation of duties is enforced
	per-transaction in `separation.py`, not by forbidding the combination."""
	granted: set[str] = set()
	for persona in personas_for_roles(roles):
		granted |= persona.capabilities
	return frozenset(granted)


def widest_row_scope(roles) -> RowScope:
	"""The most permissive scope the user's personas allow. NONE when they hold
	no GDB persona at all - deny by default."""
	scopes = [p.row_scope for p in personas_for_roles(roles)]
	if not scopes:
		return RowScope.NONE
	return max(scopes, key=lambda s: _ROW_SCOPE_RANK[s])


def capability_catalogue() -> dict[str, list[str]]:
	"""capability -> the persona keys that hold it. Used by the admin screen and
	by the registry self-test to show what a grant actually buys."""
	catalogue: dict[str, list[str]] = {c: [] for c in cap.ALL_CAPABILITIES}
	for persona in ACTIVE_PERSONAS:
		for c in persona.capabilities:
			catalogue[c].append(persona.key)
	return catalogue
