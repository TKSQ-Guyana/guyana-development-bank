"""The KYC register, for GDB staff.

Endpoints: /api/method/gdb_bank.kyc.<name>

  get_kyc_record(id_number=None, profile_id=None)   one person, every field
  list_kyc_records(search=None, region=None, ...)    a page of people

Who may read is the GDB KYC Record doctype's own permission — System Manager
and loan officers — so granting or removing access is a role change on the desk,
never a code change. A citizen, a guest or any other staff role is refused.

These are real people's identity numbers, phones and bank accounts, so every
read is logged with who asked and for what. Sign-up's own lookup is a different
door (tin_auth.lookup_national_id): public, rate-limited, and it never returns a phone
whole.
"""

import frappe
from frappe import _
from frappe.utils import cint

from gdb_bank.integrations.kyc_registry import DOCTYPE, normalize_id
from gdb_bank.utils.session import _logger, _session_user

FIELDS = [
	"profile_id",
	"full_name",
	"surname",
	"forenames",
	"id_type",
	"id_number",
	"passport_number",
	"date_of_birth",
	"sex",
	"contact_number",
	"cg_contact_number",
	"region",
	"village_id",
	"village_name",
	"other_village",
	"lot_street",
	"street",
	"address",
	"bank",
	"bank_branch",
	"account_number",
	"name_on_account",
	"account_type",
	"payment_status",
	"disbursement_cycle",
	"cheque_number",
	"registration_type",
	"pensioner",
	"shutin",
	"modified",
]

# What a list row carries — enough to find the person, not their bank details.
LIST_FIELDS = ["profile_id", "full_name", "id_number", "date_of_birth", "sex", "region", "village_name", "modified"]

MAX_PAGE = 100


def _reader() -> str:
	user = _session_user()
	if not frappe.has_permission(DOCTYPE, "read", user=user):
		_logger().warning(f"kyc: denied to {user}")
		frappe.throw(_("You do not have access to the KYC register."), frappe.PermissionError)
	return user


@frappe.whitelist(methods=["GET", "POST"])
def get_kyc_record(id_number: str | None = None, profile_id: str | None = None) -> dict:
	"""One person on the register, every field — by ID number (as on the
	register, letters included; dashes and spaces allowed) or by profile ID."""
	user = _reader()
	number = normalize_id(id_number)
	if profile_id:
		name = frappe.db.exists(DOCTYPE, (profile_id or "").strip())
	elif number:
		name = frappe.db.get_value(DOCTYPE, {"id_number": number})
	else:
		frappe.throw(_("Give an ID number or a profile ID."))
	if not name:
		frappe.throw(_("No one on the KYC register matches that."), frappe.DoesNotExistError)
	_logger().info(f"kyc: {user} read {name}")
	return frappe.db.get_value(DOCTYPE, name, FIELDS, as_dict=True)


@frappe.whitelist(methods=["GET", "POST"])
def list_kyc_records(search: str | None = None, region: str | None = None, start=0, page_length=20) -> dict:
	"""A page of the register, newest change first. `search` matches a name, ID
	number or profile ID; `region` is the register's own value ("Region 04")."""
	user = _reader()
	filters = {}
	if region:
		filters["region"] = region.strip()
	or_filters = None
	text = (search or "").strip()
	if text:
		like = f"%{text}%"
		or_filters = {"full_name": ["like", like], "profile_id": ["like", like]}
		if normalize_id(text):
			or_filters["id_number"] = ["like", f"%{normalize_id(text)}%"]
	start = max(cint(start), 0)
	page_length = min(max(cint(page_length) or 20, 1), MAX_PAGE)
	rows = frappe.get_all(
		DOCTYPE,
		filters=filters,
		or_filters=or_filters,
		fields=LIST_FIELDS,
		order_by="modified desc",
		start=start,
		page_length=page_length,
	)
	total = len(frappe.get_all(DOCTYPE, filters=filters, or_filters=or_filters, pluck="name"))
	_logger().info(f"kyc: {user} listed {len(rows)} of {total} (search={text!r}, region={region!r})")
	return {"rows": rows, "total": total, "start": start, "page_length": page_length}
