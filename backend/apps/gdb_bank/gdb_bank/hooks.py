app_name = "gdb_bank"
app_title = "GDB Bank"
app_publisher = "TKSQ Guyana"
app_description = "Guyana Development Bank citizen loan portal backend"
app_email = "akhil.adepu@theksquaregroup.com"
app_license = "MIT"

# Desk list of lending's Loan Application: pill shows the real status.
doctype_list_js = {"Loan Application": "public/js/loan_application_list.js"}

before_install = ["gdb_bank.install.ensure_roles"]
after_install = ["gdb_bank.install.after_install"]
after_migrate = ["gdb_bank.install.after_migrate"]
