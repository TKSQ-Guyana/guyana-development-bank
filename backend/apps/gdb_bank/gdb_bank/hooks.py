app_name = "gdb_bank"
app_title = "GDB Bank"
app_publisher = "TKSQ Guyana"
app_description = "Guyana Development Bank citizen loan portal backend"
app_email = "akhil.adepu@theksquaregroup.com"
app_license = "MIT"

# Desk list of lending's Loan Application: pill shows the real status.
doctype_list_js = {"Loan Application": "public/js/loan_application_list.js"}

# ---------------------------------------------------------------------------
# Row-level security
# ---------------------------------------------------------------------------
# Both hooks are generated from `rbac/scoping.SCOPES`, so adding a scoped
# DocType never means remembering to edit this file. They are what stops a
# Citizen reading another Citizen's case through `/api/resource/...`, a desk
# list or a report - paths that never touch `gdb_bank.api.*` and so are not
# covered by the capability guards.
#
# `permission_query_conditions` filters LIST reads; `has_permission` gates
# SINGLE documents. Under Frappe v16 a `has_permission` hook must return True
# explicitly to grant - returning None now denies.
from gdb_bank.security.row_level import hook_map  # noqa: E402

permission_query_conditions = hook_map("permission_query_conditions")
has_permission = hook_map("has_permission")

# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------
# Runs on every login path (SPA PKCE exchange, Frappe Social Login, desk
# password). Converges the user's GDB roles onto what Keycloak says and applies
# the kill switch to an account disabled upstream.
on_session_creation = "gdb_bank.security.keycloak.on_session_creation"

# ---------------------------------------------------------------------------
# Install / migrate
# ---------------------------------------------------------------------------
# `ensure_roles` runs before install so the DocType JSONs can reference the GDB
# roles; `reconcile_rbac` runs after every migrate so a registry edit reaches a
# deployed site by `bench migrate` alone.
before_install = ["gdb_bank.install.ensure_roles"]
after_install = ["gdb_bank.install.after_install"]
after_migrate = ["gdb_bank.install.after_migrate"]
