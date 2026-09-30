app_name = "gdb_bank"
app_title = "GDB Bank"
app_publisher = "TKSQ Guyana"
app_description = "Guyana Development Bank citizen loan portal backend"
app_email = "akhil.adepu@theksquaregroup.com"
app_license = "MIT"

# Desk list of lending's Loan Application: pill shows the real status.
doctype_list_js = {"Loan Application": "public/js/loan_application_list.js"}

# A citizen holds read on Loan (install.ensure_loan_permissions) because
# lending checks it; these two scope that read to their own rows. The evidence
# doctypes are scoped the same way: a citizen holds the role permission and
# these hooks decide which rows it reaches, so the framework does the filtering
# rather than every endpoint remembering to.
permission_query_conditions = {
	"Loan": "gdb_bank.permissions.loan_query_conditions",
	"GDB Applicant Document": "gdb_bank.permissions.own_records_query_conditions",
	"GDB Information Request": "gdb_bank.permissions.own_records_query_conditions",
	"GDB Field Officer Request": "gdb_bank.permissions.own_records_query_conditions",
	"GDB Citizen Profile": "gdb_bank.permissions.profile_query_conditions",
}
has_permission = {
	"Loan": "gdb_bank.permissions.loan_has_permission",
	"GDB Applicant Document": "gdb_bank.permissions.own_record_has_permission",
	"GDB Information Request": "gdb_bank.permissions.own_record_has_permission",
	"GDB Field Officer Request": "gdb_bank.permissions.own_record_has_permission",
	"GDB Citizen Profile": "gdb_bank.permissions.profile_has_permission",
}

# Evidence arrives through Frappe's own /api/method/upload_file, so the format
# and size limits are enforced where the file is created rather than in the
# endpoint that registers it afterwards.
#
# The platform administrator's limits on accounts (grantable roles only, never
# their own account, never another administrator's, never a password) are
# enforced on every User save, so the desk and /api/resource cannot route
# around services/accounts.py.
doc_events = {
	"File": {"before_insert": "gdb_bank.documents.validate_attachment"},
	"User": {"validate": "gdb_bank.security.role_policy.validate_user_change"},
}

# Keycloak authenticates everybody; which realm vouched for a sign-in decides
# which kind of account it may open. Runs before Frappe mints the session.
on_login = ["gdb_bank.security.sign_in_policy.enforce"]

before_install = ["gdb_bank.install.ensure_roles"]
after_install = ["gdb_bank.install.after_install"]
after_migrate = ["gdb_bank.install.after_migrate"]
