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
	"GDB Citizen Profile": "gdb_bank.permissions.profile_query_conditions",
}
has_permission = {
	"Loan": "gdb_bank.permissions.loan_has_permission",
	"GDB Applicant Document": "gdb_bank.permissions.own_record_has_permission",
	"GDB Information Request": "gdb_bank.permissions.own_record_has_permission",
	"GDB Citizen Profile": "gdb_bank.permissions.profile_has_permission",
}

# Evidence arrives through Frappe's own /api/method/upload_file, so the format
# and size limits are enforced where the file is created rather than in the
# endpoint that registers it afterwards.
doc_events = {"File": {"before_insert": "gdb_bank.documents.validate_attachment"}}

before_install = ["gdb_bank.install.ensure_roles"]
after_install = ["gdb_bank.install.after_install"]
after_migrate = ["gdb_bank.install.after_migrate"]
