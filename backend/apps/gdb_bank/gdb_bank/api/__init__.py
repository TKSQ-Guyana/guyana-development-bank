"""Whitelisted HTTP surface.

One module per bounded context, versioned in the filename so a breaking change
to the portal contract ships as `v2_*` alongside `v1_*` rather than as a silent
behaviour change.

Controllers here do three things and nothing else: parse the payload, call a
service, shape the response. Every authorization decision, every state
transition and every audit write belongs in `services/`, guarded by
`rbac/guards.py`. If a function in this package contains an `if role ==`, it is
in the wrong layer.

    v1_identity.py   exchange_token, whoami, registry
    v1_admin.py      persona grants, kill switch, rbac_status
    v0_legacy.py     DEPRECATED pre-registry endpoints — see below

--------------------------------------------------------------------------
THE RE-EXPORTS BELOW ARE LOAD-BEARING. DO NOT DELETE THEM CASUALLY.
--------------------------------------------------------------------------
This package replaced a module at `gdb_bank/api.py`. Python resolves a package
directory in preference to a same-named `.py` file, so the moment `api/`
existed, every `gdb_bank.api.<name>` endpoint in that file became unreachable —
silently, with the file still sitting there looking correct.

The current SPA build calls these paths:

    gdb_bank.api.signup        gdb_bank.api.loan_detail
    gdb_bank.api.apply_loan    gdb_bank.api.all_loans
    gdb_bank.api.my_loans      gdb_bank.api.review_loan

Frappe resolves a whitelisted method by importing the dotted path and taking
the attribute, so re-exporting the functions here keeps those paths working
while the implementation lives in `v0_legacy.py`. The re-exported objects are
the same function objects `@frappe.whitelist()` registered, so the whitelist
check still passes.

Remove each name below only when the SPA has stopped calling it.
"""

from gdb_bank.api.v0_legacy import (  # noqa: F401
	all_loans,
	apply_loan,
	loan_detail,
	my_loans,
	review_loan,
	signup,
	whoami,
)

__all__ = [
	"all_loans",
	"apply_loan",
	"loan_detail",
	"my_loans",
	"review_loan",
	"signup",
	"whoami",
]
