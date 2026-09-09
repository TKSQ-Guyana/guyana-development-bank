app_name = "gdb_bank"
app_title = "GDB Bank"
app_publisher = "TKSQ Guyana"
app_description = "Guyana Development Bank citizen loan portal backend"
app_email = "akhil.adepu@theksquaregroup.com"
app_license = "MIT"

# Roles must exist before the Loan Application doctype (whose DocPerms link to
# them) is synced, hence before_install as well as the idempotent re-checks.
before_install = ["gdb_bank.install.ensure_roles"]
after_install = ["gdb_bank.install.after_install"]
after_migrate = ["gdb_bank.install.ensure_roles"]
