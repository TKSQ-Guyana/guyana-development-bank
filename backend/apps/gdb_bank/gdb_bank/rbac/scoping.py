"""How each case-level DocType is scoped to a person - declared, not coded.

`RowScope` on a persona says HOW FAR that persona may see. This table says, for
each DocType, WHICH COLUMNS carry the identity that scope is measured against.
One generic SQL builder (`security/row_level.py`) then serves every DocType, so
a new case-level DocType is one row here rather than a new hook function.

WHY EID AND NOT OWNER
    features.md: queues identify people by e-ID, not email. `owner` is a Frappe
    User and can be a facilitator who created a draft for someone else - it is
    the wrong column to scope a citizen's view on. Every scoped DocType
    therefore carries an explicit `subject_eid`.
"""

from __future__ import annotations

from dataclasses import dataclass

from gdb_bank.rbac import personas as reg


@dataclass(frozen=True)
class ScopeSpec:
	doctype: str

	subject_eid_field: str = "subject_eid"
	"""Column holding the e-ID of the person the row is ABOUT."""

	facilitator_eid_field: str | None = "facilitator_eid"
	"""Column holding the e-ID mandated to act on this row, if the DocType
	supports delegation. None means delegation does not apply."""

	parent_field: str | None = None
	"""For child-ish DocTypes (documents, conditions) that carry no e-ID of
	their own: the Link field pointing at the application whose scope they
	inherit."""

	parent_doctype: str | None = None


SCOPES: tuple[ScopeSpec, ...] = (
	ScopeSpec(doctype=reg.APPLICATION),
	ScopeSpec(doctype=reg.CONSENT, facilitator_eid_field=None),
	ScopeSpec(doctype=reg.CLUSTER, facilitator_eid_field="facilitator_eid"),
	ScopeSpec(doctype=reg.MANDATE),
	ScopeSpec(
		doctype=reg.DOCUMENT,
		parent_field="application",
		parent_doctype=reg.APPLICATION,
	),
	ScopeSpec(
		doctype=reg.CONDITION,
		parent_field="application",
		parent_doctype=reg.APPLICATION,
	),
	ScopeSpec(
		doctype=reg.INFO_REQUEST,
		parent_field="application",
		parent_doctype=reg.APPLICATION,
	),
)

BY_DOCTYPE: dict[str, ScopeSpec] = {s.doctype: s for s in SCOPES}

SCOPED_DOCTYPES: tuple[str, ...] = tuple(BY_DOCTYPE)


def spec_for(doctype: str) -> ScopeSpec | None:
	return BY_DOCTYPE.get(doctype)
