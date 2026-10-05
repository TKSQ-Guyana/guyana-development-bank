"""Loan-application banking rules: draft save, submission, discard, the one-shot
apply, and the read paths a borrower sees (their list, one case, the booked loan
account).

Storage is the official frappe/lending app's Loan Application doctype; this
layer maps the stable portal contract onto it and enforces what a draft may
hold and who may read a case. The whitelisted endpoints in gdb_bank.api are thin
wrappers that hand in the session user. Who shares a group's case is the
cluster service's rule.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, nowdate

from gdb_bank.install import APPLICATION_SECTIONS, EMPLOYER_CATEGORIES, INCOME_BANDS
from gdb_bank.utils import policy
from gdb_bank.utils.constants import (
	EXISTING_ONLY,
	LOAN_ACCOUNT_FIELDS,
	LOAN_FIELDS,
	NEW_ONLY,
	PORTAL_PRODUCTS,
	QUICK_ONLY,
	QUICK_PRODUCT,
	SECTION_KEYS,
	SME_ONLY,
	STANDARD_PRODUCT,
)
from gdb_bank.utils.formatters import (
	_for_viewer,
	_normalised_phone,
	_portal_dict,
	_portal_product,
	_schedule_instalments,
	_stage_context,
)
from gdb_bank.utils.session import _as_system, _eids, _is_staff, _logger, _session_user
from gdb_bank.security.conflict import is_same_person
from gdb_bank.services.cluster import (
	REQUIRED_PLAN,
	_cluster_for,
	_clusters_of,
	_is_shared_with,
	_require_facilitator_of,
	notify_group_submitted,
	roster_split,
)
from gdb_bank.services import eligibility
from gdb_bank.services.evidence import missing_evidence
from gdb_bank.services.user import _get_or_create_customer


def _blanked(fieldnames) -> dict:
	"""Empty values for these fields, each of its own type."""
	by_name = {f[0]: f[2] for f in APPLICATION_SECTIONS}
	return {f: (0 if by_name.get(f) in ("Currency", "Int", "Percent", "Check") else "") for f in fieldnames}


def _product(product: str | None) -> str:
	"""The portal product key the caller asked for; omitted means the standard loan."""
	key = (product or STANDARD_PRODUCT).strip().lower()
	if key not in PORTAL_PRODUCTS:
		frappe.throw(_("{0} is not a GDB loan product.").format(product))
	return key


# What a Quick Loan must say about the trade, and how the form is told it did not.
_QUICK_REQUIRED = {
	"gdb_trade_activity": "Tell us what your business sells or does.",
	"gdb_trade_region": "Choose the region you do business in.",
	"gdb_trading_since": "Tell us how long you have been in business.",
	"gdb_trade_location": "Choose your business location.",
	"gdb_trade_latitude": "Pin your business on the map.",
	"gdb_trade_longitude": "Pin your business on the map.",
	"gdb_support_1_name": "Enter the name of your first supporting contact.",
	"gdb_support_1_relationship": "Enter how your first supporting contact knows you.",
	"gdb_support_1_phone": "Enter a phone number for your first supporting contact.",
	"gdb_support_2_name": "Enter the name of your second supporting contact.",
	"gdb_support_2_relationship": "Enter how your second supporting contact knows you.",
	"gdb_support_2_phone": "Enter a phone number for your second supporting contact.",
	"gdb_resides_in_guyana": "Confirm that you live in Guyana.",
}

# Supporting contacts' numbers, held in the same shape as the applicant's own.
_QUICK_PHONES = ("gdb_support_1_phone", "gdb_support_2_phone")

# Guyana's extent, generously: a pin outside it is a slip of the map, not a
# business GDB lends to.
_GUYANA_LAT = (1.0, 8.7)
_GUYANA_LNG = (-61.5, -56.3)


def _guyana_local_phone(raw) -> str:
	digits = "".join(c for c in str(raw or "") if c.isdigit())
	if len(digits) == 10 and digits.startswith("592"):
		digits = digits[3:]
	return f"+592{digits}" if len(digits) == 7 else ""


def _check_in_guyana(lat, lng) -> None:
	if not lat and not lng:
		return  # the required-field check names what is missing
	if not (_GUYANA_LAT[0] <= flt(lat) <= _GUYANA_LAT[1] and _GUYANA_LNG[0] <= flt(lng) <= _GUYANA_LNG[1]):
		frappe.throw(_("Pin a location in Guyana."))


def _use_of_funds_lines(raw) -> list[dict]:
	"""The use-of-funds lines as child-table rows, from what the form sent.

	The form sends a list of {item, amount} — as a list, or JSON-encoded the way
	the portal always has. A line with no item is dropped, as the form drops it.
	Plain text that is not a list (a caller from before the table existed) is
	kept as one line with no amount rather than thrown away.
	"""
	if isinstance(raw, str):
		text = raw.strip()
		if not text:
			return []
		try:
			raw = frappe.parse_json(text)
		except Exception:
			return [{"item": text, "amount": 0}]
		if not isinstance(raw, list):
			return [{"item": text, "amount": 0}]
	if not isinstance(raw, list):
		return []
	lines = []
	for row in raw:
		if not isinstance(row, dict):
			continue
		item = (row.get("item") or "").strip() if isinstance(row.get("item"), str) else ""
		if not item:
			continue
		amount = flt(row.get("amount"))
		if amount < 0:
			frappe.throw(_("A use-of-funds amount cannot be negative."))
		lines.append({"item": item, "amount": amount})
	return lines


def _section_values(sections) -> dict:
	"""Section B-H answers, whitelisted against the table and coerced by type.

	Anything the table does not name is DROPPED rather than written. This is
	reached from a whitelisted endpoint, and handing an arbitrary dict to
	doc.update() would let any caller set any field on the Loan Application —
	including the permlevel-1 status this module is careful never to touch
	outside review_loan.
	"""
	if not sections:
		return {}
	if isinstance(sections, str):
		sections = frappe.parse_json(sections)
	if not isinstance(sections, dict):
		return {}

	values = {}
	# Partners and shareholders, as rows. Handled outside the SECTION_KEYS loop
	# because unlike use_of_funds there is no legacy text field to derive the
	# key from — the ownership table was a table from the start.
	if "ownership_lines" in sections:
		values["gdb_ownership_lines"] = _ownership_lines(sections.get("ownership_lines"))
	if "existing_debts" in sections:
		values["gdb_existing_debt_lines"] = _existing_debt_lines(sections.get("existing_debts"))
	for key, (fieldname, fieldtype) in SECTION_KEYS.items():
		if key not in sections:
			continue
		raw = sections.get(key)
		if key == "use_of_funds":
			# Rows of the gdb_use_of_funds_lines child table, not text: each
			# amount is then a Currency column Frappe can SUM.
			values["gdb_use_of_funds_lines"] = _use_of_funds_lines(raw)
			continue
		if key == "existing_debts":
			continue
		if fieldtype in ("Currency", "Percent", "Float"):
			values[fieldname] = flt(raw)
		elif fieldtype == "Date":
			# "" is not a date: MySQL refuses it. Unanswered is NULL.
			values[fieldname] = (raw.strip() if isinstance(raw, str) else raw) or None
		elif fieldtype in ("Int", "Check"):
			values[fieldname] = cint(raw)
		else:
			values[fieldname] = (raw or "").strip() if isinstance(raw, str) else (raw or "")
	return values


DEBT_STATUSES = ("Current", "In arrears", "Restructured", "Paid off")


def _existing_debt_lines(raw) -> list[dict]:
	"""The debts the applicant declared, as child-table rows. A row with no lender
	is a blank line in the form, and dropped."""
	if isinstance(raw, str):
		try:
			raw = frappe.parse_json(raw) if raw.strip() else []
		except Exception:
			return []
	lines = []
	for row in raw if isinstance(raw, list) else []:
		if not isinstance(row, dict):
			continue
		lender = (row.get("lender") or "").strip() if isinstance(row.get("lender"), str) else ""
		if not lender:
			continue
		amount = flt(row.get("amount"))
		if amount < 0:
			frappe.throw(_("An existing debt cannot be a negative amount."))
		status = (row.get("status") or "").strip()
		if status and status not in DEBT_STATUSES:
			frappe.throw(_("Choose the status of each existing debt."))
		lines.append({"lender": lender[:140], "amount": amount, "status": status})
	return lines


def _ownership_lines(raw) -> list[dict]:
	"""Declared partners and shareholders as child-table rows.

	Shaped exactly like `_use_of_funds_lines`: the form sends a list of
	{eid, name, share}, as a list or JSON-encoded. A row naming nobody is
	dropped, because a blank line in a form is not a co-owner.

	Nothing here checks that the e-ID belongs to a real person, and that is
	deliberate — these are DECLARED owners. Naming somebody is not the same as
	that person agreeing, and a co-owner who must consent does so through their
	own sign-in.
	"""
	if isinstance(raw, str):
		text = raw.strip()
		if not text:
			return []
		try:
			raw = frappe.parse_json(text)
		except Exception:
			return []
	if not isinstance(raw, list):
		return []

	rows = []
	for line in raw:
		if not isinstance(line, dict):
			continue
		eid = (line.get("eid") or "").strip()
		name = (line.get("name") or "").strip()
		if not eid and not name:
			continue
		rows.append(
			{"holder_eid": eid, "holder_name": name, "share_percent": flt(line.get("share"))}
		)
	return rows


def _check_shares(values: dict) -> None:
	"""The applicant's share plus everybody else's may not exceed 100.

	Checked on the SERVER because the form is not the enforcement boundary, and
	checked on the DRAFT as well as the submission because `_validated` is
	shared by both — a draft must not be able to hold what a submission would
	have refused.

	A total UNDER 100 is allowed and deliberately so: an applicant who does not
	know every shareholder of the company they work in should not be blocked
	from applying, and an underwriter reading 60% declared knows to ask about
	the rest. Only a total over 100, which cannot be true of anything, is
	refused.
	"""
	if values.get("gdb_legal_structure") in ("Partnership", "Incorporated (Inc.)") and flt(
		values.get("gdb_applicant_share")
	) >= 100:
		frappe.throw(_("Your share must be less than 100%. The other owners hold the rest."))
	declared = flt(values.get("gdb_applicant_share"))
	declared += sum(flt(row.get("share_percent")) for row in values.get("gdb_ownership_lines") or [])
	if declared > 100:
		frappe.throw(
			_("The declared ownership shares add up to {0}%. They cannot exceed 100%.").format(
				flt(declared, 2)
			)
		)


def _validated(
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
	user: str | None = None,
	product: str | None = None,
	group: str | None = None,
) -> dict:
	"""Check what the applicant typed, and answer the fields to write.

	`group` is a cluster ALREADY authorised by save_group_application — the
	facilitator's path, filing for `user` as the group's head. A citizen's own
	path never passes it, and naming a cluster there is refused.

	Shared by the draft save and the one-shot apply, so that a draft cannot hold
	anything a submitted application would have refused.

	`product` is the portal key — `standard` (the default) or `quick`. The Quick
	Loan's ceiling is not checked here: it is the product's own
	maximum_loan_amount, which lending's Loan Application refuses on save.
	"""
	user = user or _session_user()
	product = _product(product)
	quick = product == QUICK_PRODUCT

	loan_amount = flt(loan_amount)
	term_months = cint(term_months)
	purpose = (purpose or "").strip()
	longest = policy.quick_loan_max_term() if quick else policy.MAX_TERM
	if loan_amount <= 0:
		frappe.throw(_("Loan amount must be greater than zero."))
	if quick:
		allowed = policy.quick_loan_terms()
		if term_months not in allowed:
			frappe.throw(
				_("Choose a term of {0} months.").format(
					", ".join(str(t) for t in allowed[:-1]) + " or " + str(allowed[-1]) if len(allowed) > 1 else allowed[0]
				)
			)
	elif not cluster and not group:
		# An SME Direct Loan is repaid over one of the programme's terms.
		low, high = policy.sme_term_bounds()
		if not (low <= term_months <= high):
			frappe.throw(_("Choose a term of {0} to {1} months.").format(low, high))
	elif not (1 <= term_months <= longest):
		frappe.throw(_("Term must be between 1 and {0} months.").format(longest))
	if not purpose:
		frappe.throw(_("Purpose is required."))
	# When repayments start, on either form: one of the programme's moratoria,
	# or not chosen yet (0) on a draft — submit_application then asks for it.
	if not cluster and not group:
		moratorium = cint(_section_values(sections).get("gdb_moratorium_months"))
		if moratorium and moratorium not in policy.moratorium_options():
			frappe.throw(_(MORATORIUM_MESSAGE).format(policy.months_phrase(policy.moratorium_options())))

	# A Quick Loan is one trader's own. Refused rather than ignored, because a
	# head who names their group is asking for something this product is not.
	if quick and (cluster or "").strip():
		frappe.throw(_("A Quick Loan cannot be filed for a group."))
	cluster = group or _cluster_for(user, cluster)

	if quick:
		# No registration and no stage: neither is a question an informal trader
		# can answer. The name they trade under, if they have one, is optional.
		business_stage, dcra_number = "", ""
		business_name = (business_name or "").strip()
	else:
		# Existing vs new business is a real fork, not a label: an existing
		# trading business is expected to name its DCRA registration, a start-up
		# has none to give. Enforce that here so an underwriter never sees
		# "Existing" with nothing behind it.
		business_stage = (business_stage or "").strip().title()
		if business_stage and business_stage not in ("Existing", "New"):
			frappe.throw(_("Business stage must be Existing or New."))
		dcra_number = (dcra_number or "").strip().upper()
		business_name = (business_name or "").strip()
		if business_stage == "Existing" and not dcra_number:
			frappe.throw(_("Give the DCRA registration number of your existing business."))
		if business_stage == "New" and cluster:
			# A group's start-up has no registration yet, so never carry one over.
			# A single SME names its DCRA number whether new or existing (it is
			# required at submission).
			dcra_number = ""
		# A single SME is not asked its name: it comes from the business registry
		# when the DCRA number is found there, and is blank otherwise. A group's
		# facilitator still names the business it files for.
		if business_stage and not business_name and cluster:
			frappe.throw(_("Business name is required."))

	loan_product = frappe.db.get_value("Loan Product", {"product_name": PORTAL_PRODUCTS[product]})
	if not loan_product:
		frappe.throw(_("Loan Product is not configured. Contact the administrator."))

	values = {
		"applicant_type": "Customer",
		"applicant": _get_or_create_customer(user),
		"applicant_name": frappe.utils.get_fullname(user),
		"applicant_email_address": user,
		"applicant_phone_number": _normalised_phone(phone),
		"company": frappe.db.get_value("Loan Product", loan_product, "company"),
		"posting_date": nowdate(),
		"loan_product": loan_product,
		"loan_amount": loan_amount,
		"is_term_loan": 1,
		"repayment_method": "Repay Over Number of Periods",
		"repayment_periods": term_months,
		"status": "Open",
		"gdb_owner": user,
		"gdb_purpose": purpose,
		"gdb_monthly_income": flt(monthly_income) if monthly_income else 0,
		"gdb_cluster": cluster,
		"gdb_business_stage": business_stage,
		"gdb_dcra_number": dcra_number,
		"gdb_business_name": business_name,
	}
	values.update(_section_values(sections))
	if quick:
		# Sections B-H are the SME's, so a Quick Loan carries none of them —
		# including the use-of-funds and ownership rows.
		values.update(_blanked(SME_ONLY))
		values["gdb_use_of_funds_lines"] = []
		values["gdb_ownership_lines"] = []
		values["gdb_existing_debt_lines"] = []
		# A supporting contact's number is a GUYANA number: seven digits, with or
		# without the 592 the portal shows as a fixed prefix. Held as +592 and the
		# seven digits; anything else is dropped, so the check below asks for one.
		# The portal applies the same rule (components/PhoneInput.tsx).
		for fieldname in _QUICK_PHONES:
			values[fieldname] = _guyana_local_phone(values.get(fieldname))
		_check_in_guyana(values.get("gdb_trade_latitude"), values.get("gdb_trade_longitude"))
		for fieldname, message in _QUICK_REQUIRED.items():
			if not values.get(fieldname):
				frappe.throw(_(message))
	else:
		values.update(_blanked(QUICK_ONLY))
		if values.get("gdb_has_mentor") != "Yes":
			values["gdb_mentor_details"] = ""
			values["gdb_mentor_first_name"] = values["gdb_mentor_last_name"] = values["gdb_mentor_phone"] = ""
		elif values.get("gdb_mentor_phone"):
			values["gdb_mentor_phone"] = _guyana_local_phone(values["gdb_mentor_phone"])
		# The day a business was established is a day that has happened.
		established = values.get("gdb_date_established")
		if established and getdate(established) > getdate(nowdate()):
			frappe.throw(_("The date your business was established cannot be in the future."))
	_public_service(values)
	# The stage decides which financial block is meaningful, so switching it
	# clears the other one. Same reasoning as dropping the DCRA number above:
	# a start-up must never carry filed accounts, and a trading business must
	# never be decided on forecasts it did not make.
	if business_stage == "Existing":
		values.update(_blanked(NEW_ONLY))
	elif business_stage == "New":
		values.update(_blanked(EXISTING_ONLY))
	_check_shares(values)
	return values



MORATORIUM_MESSAGE = "Choose when you want to start repaying: after {0} months."


# A public-sector employee in these bands is routed to a Loan Officer: the
# successor of the old "public servant earning GYD 250,000 or more" rule.
REVIEW_BANDS = ("Between $200K and $500K", "Above $500K")


def _public_service(values: dict) -> None:
	"""The applicant's declarations, kept consistent, and the review flag they set.

	Each follow-up belongs to its "Yes", so a "No" clears it: no E-ID, no
	number; not employed, no employer. A public-sector employee earning GYD
	200,000 a month or more may still apply: the case is routed to a Loan
	Officer, never refused. The flag is the server's conclusion, so whatever
	the form sent for it is overwritten.
	"""
	for fieldname in ("gdb_applicant_eid", "gdb_public_service_ministry", "gdb_employer_name"):
		values[fieldname] = (values.get(fieldname) or "").strip()
	# A draft from before the question: a number given means "Yes".
	if not values.get("gdb_has_eid") and values.get("gdb_applicant_eid"):
		values["gdb_has_eid"] = "Yes"
	if values.get("gdb_has_eid") == "No":
		values["gdb_applicant_eid"] = ""
	if values.get("gdb_employed") != "Yes":
		values["gdb_employer_category"] = values["gdb_employer_name"] = values["gdb_income_band"] = ""
	if values.get("gdb_public_service_employed") != "Yes":
		values["gdb_public_service_ministry"] = ""
		values["gdb_public_service_under_250k"] = ""
	values["gdb_requires_loan_officer_review"] = int(
		(
			values.get("gdb_employed") == "Yes"
			and values.get("gdb_employer_category") == "Public Sector"
			and values.get("gdb_income_band") in REVIEW_BANDS
		)
		# Applications made before 2026-10-05 keep the old rule.
		or (values.get("gdb_public_service_employed") == "Yes" and values.get("gdb_public_service_under_250k") == "No")
	)
	_check_industry(values)


def _check_industry(values: dict) -> None:
	"""The industry and sub-sector, when given, are GDB's own and agree."""
	sector, sub = (values.get("gdb_sector") or "").strip(), (values.get("gdb_sub_sector") or "").strip()
	values["gdb_sector"], values["gdb_sub_sector"] = sector, sub
	if sector and not frappe.db.exists("GDB Sector", {"name": sector, "disabled": 0}):
		frappe.throw(_("Choose your industry from the list."))
	if sub and frappe.db.get_value("GDB Sub Sector", sub, "sector") != sector:
		frappe.throw(_("Choose a sub-sector of {0}.").format(sector or _("your industry")))


def _require_declarations(doc) -> None:
	"""The applicant's declarations (both forms), answered before the case goes
	to GDB. Asked at submission rather than on every save, so a draft saved
	before the questions existed can still be opened and finished.

	2026-10-05: "Are you employed?" replaces the public-service question, and
	"related to a GDB employee" is no longer asked."""
	from gdb_bank.utils.eid import EID_SHAPE, normalize_eid

	if doc.gdb_has_eid not in ("Yes", "No"):
		frappe.throw(_("Tell us whether you have an E-ID."))
	if doc.gdb_has_eid == "Yes":
		eid = normalize_eid(doc.gdb_applicant_eid)
		if not eid:
			frappe.throw(_("Enter your E-ID."))
		if not EID_SHAPE.match(eid):
			frappe.throw(_("Enter your E-ID in the format xxx-xxxx-xxxx."))
		doc.gdb_applicant_eid = eid
	if doc.gdb_employed not in ("Yes", "No"):
		frappe.throw(_("Tell us whether you are employed."))
	if doc.gdb_employed == "Yes":
		if doc.gdb_employer_category not in EMPLOYER_CATEGORIES:
			frappe.throw(_("Choose your employer category: Public Sector or Private Sector."))
		if not (doc.gdb_employer_name or "").strip():
			frappe.throw(_("Enter your employer's name."))
		if doc.gdb_income_band not in INCOME_BANDS:
			frappe.throw(_("Choose your monthly income."))
	if not (doc.gdb_sector or "").strip():
		frappe.throw(_("Choose your industry."))
	# Asked only of an industry that has sub-sectors (GDB Sub Sector).
	if not (doc.gdb_sub_sector or "").strip() and frappe.db.exists(
		"GDB Sub Sector", {"sector": doc.gdb_sector, "disabled": 0}
	):
		frappe.throw(_("Choose your sub-sector."))


def _require_sme_details(doc) -> None:
	"""What a single SME application must carry before it goes to GDB."""
	from gdb_bank.utils.eid import EID_SHAPE, normalize_eid

	# The e-ID is optional on an SME Loan (GDB, 2026-10-04): "Do you have an
	# E-ID?" decides whether it is asked (_require_declarations).
	eid = normalize_eid(doc.gdb_applicant_eid)
	if eid and not EID_SHAPE.match(eid):
		frappe.throw(_("Enter your E-ID in the format xxx-xxxx-xxxx."))
	doc.gdb_applicant_eid = eid
	# A new business is not asked for a registration (GDB, 2026-10-04): only an
	# existing one names its DCRA number, and the date it was established
	# (submit_application).
	if (doc.gdb_business_stage or "").title() == "Existing" and not (doc.gdb_dcra_number or "").strip():
		frappe.throw(_("Give the DCRA registration number of your business."))
	if (doc.gdb_business_stage or "").title() == "New":
		if doc.gdb_industrial_training not in ("Yes", "No"):
			frappe.throw(_("Tell us whether you are part of an industrial training program."))
		if doc.gdb_has_mentor not in ("Yes", "No"):
			frappe.throw(_("Tell us whether you have a mentor."))
		if doc.gdb_has_mentor == "Yes":
			for field, message in (
				("gdb_mentor_first_name", "Give your mentor's first name."),
				("gdb_mentor_last_name", "Give your mentor's last name."),
				("gdb_mentor_phone", "Give your mentor's phone number."),
			):
				if not (doc.get(field) or "").strip():
					frappe.throw(_(message))
	profile = frappe.db.get_value(
		"GDB Citizen Profile", {"user": doc.gdb_owner}, ["email", "verified_email"], as_dict=True
	)
	email = (profile and (profile.email or profile.verified_email)) or ""
	if not email:
		frappe.throw(_("Add your email address."))


def _own_draft(name: str, user: str):
	"""A draft the caller owns, or a clear refusal."""
	row = frappe.db.get_value(
		"Loan Application", name, ["name", "gdb_owner", "gdb_cluster", "docstatus"], as_dict=True
	)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(name))
	if row.gdb_owner != user:
		frappe.throw(_("You may only edit your own application."), frappe.PermissionError)
	# Filed in the head's name, but the facilitator's to prepare and submit:
	# the head neither edits, submits nor discards it from their own account.
	if row.gdb_cluster:
		frappe.throw(
			_("A group's application is managed by its GDB facilitator."), frappe.PermissionError
		)
	if cint(row.docstatus) != 0:
		frappe.throw(_("{0} has already been submitted to GDB.").format(name))
	return row


def save_application(
	user: str,
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
	name: str | None = None,
	product: str | None = None,
	pending: str | None = None,
	assisted_by: str | None = None,
):
	"""Create or update the applicant's own DRAFT application.

	`assisted_by` is the Field Officer filling it with the applicant under
	their consent (api.save_application resolves that). It is recorded and
	never cleared by a later save of the applicant's own.

	`pending` names the unfinished application (profiles.save_pending_application)
	this draft continues; it is forgotten once the Loan Application holds it.

	A draft exists so evidence can be attached before the application is made:
	a document shelf needs something to hang off, and asking a citizen to
	submit first and substantiate afterwards inverts the order the Bank needs
	them in. It is the resume point too — a session that drops on a Region 9
	phone connection loses nothing already saved.

	Nothing here is before the Bank: all_loans excludes drafts, and only
	submit_application moves one across.
	"""
	values = _validated(
		loan_amount,
		purpose,
		term_months,
		monthly_income=monthly_income,
		phone=phone,
		cluster=cluster,
		business_stage=business_stage,
		dcra_number=dcra_number,
		business_name=business_name,
		sections=sections,
		user=user,
		product=product,
	)
	if assisted_by:
		values["gdb_assisted_by"] = assisted_by

	if not name and not cluster:
		# One of each kind at a time: a second draft of the same product is
		# refused before it exists, not discovered at submission.
		eligibility.require_none_open(user, _product(product))

	if name:
		_own_draft(name, user)
		doc = frappe.get_doc("Loan Application", name)
		doc.update(values)
	else:
		doc = frappe.get_doc(dict(doctype="Loan Application", **values))
	doc.flags.ignore_permissions = True
	doc.save()
	if not name:
		from gdb_bank.profiles import drop_pending

		drop_pending(user, pending)
	frappe.db.commit()
	_logger().info(
		f"draft application {doc.name} saved by {user}" + (f" with field officer {assisted_by}" if assisted_by else "")
	)
	return _portal_dict(frappe.db.get_value("Loan Application", doc.name, LOAN_FIELDS, as_dict=True))


def submit_application(
	user: str,
	name: str,
	accept_terms=None,
	credit_check_consent=None,
	submitted_by: str | None = None,
	assisted_by: str | None = None,
):
	"""Put a draft before the Bank. Evidence is EXPECTED but never blocking.

	Documents used to gate this call. They no longer do: an applicant on a
	Region 9 phone connection who cannot scan a business plan today should
	still be able to put their case in front of the Bank, and asking for the
	paperwork is a conversation the underwriter can have — `request_information`
	exists for exactly that. The expected-document list is still computed and
	still shown on both sides of the desk, so nobody decides a thin file
	without knowing it is thin.

	What is outstanding at the moment of submission goes in the log, because a
	case that arrived incomplete is a fact about the case and not just about
	the screen it was typed on.

	A Quick Loan is paid without a Letter of Offer (services/quick_loan), so its
	borrower accepts the terms HERE — `accept_terms` — and the moment is recorded.

	`submitted_by` is who actually put it before the Bank: the applicant, or a
	Field Officer for them (services/field_operations.submit_for). Recorded on
	the case either way.
	"""
	_own_draft(name, user)
	outstanding = missing_evidence(name)

	doc = frappe.get_doc("Loan Application", name)
	# Drafts do not count here — this IS the draft — but a case already with
	# the Bank, or a loan not yet repaid, does.
	eligibility.require_none_open(
		user, _portal_product(doc.loan_product), include_drafts=False, except_name=name
	)
	# The moratorium is optional (2026-10-05): none chosen is 0, repayments from
	# the month after release; one chosen must be one GDB offers.
	moratorium = cint(doc.gdb_moratorium_months)
	if not doc.gdb_cluster and moratorium and moratorium not in policy.moratorium_options():
		frappe.throw(_(MORATORIUM_MESSAGE).format(policy.months_phrase(policy.moratorium_options())))
	if not doc.gdb_cluster and _portal_product(doc.loan_product) != QUICK_PRODUCT:
		if doc.gdb_has_existing_debts not in ("Yes", "No"):
			frappe.throw(_("Tell us whether you have any existing debts."))
		if doc.gdb_has_existing_debts == "Yes":
			if not doc.get("gdb_existing_debt_lines"):
				frappe.throw(_("Give the lender, amount and status of each existing debt."))
			if any(not row.status for row in doc.gdb_existing_debt_lines):
				frappe.throw(_("Choose the status of each existing debt."))
		if (doc.gdb_business_stage or "").title() == "Existing" and not doc.gdb_date_established:
			frappe.throw(_("Give the date your business was established."))
		_require_sme_details(doc)
		_require_declarations(doc)
	if _portal_product(doc.loan_product) == QUICK_PRODUCT:
		_require_declarations(doc)
		if not cint(accept_terms):
			frappe.throw(_("Accept the terms to submit."))
		if not cint(credit_check_consent):
			frappe.throw(_("Give your consent for the credit check to submit."))
		doc.gdb_terms_accepted_on = now_datetime()
		doc.gdb_credit_consent_on = now_datetime()
	doc.gdb_submitted_by = submitted_by or user
	doc.gdb_submitted_on = now_datetime()
	if assisted_by:
		doc.gdb_assisted_by = assisted_by
	doc.flags.ignore_permissions = True
	doc.submit()
	frappe.db.commit()
	# A group's application is the group's business. Until now nothing was sent
	# at submission at all, so an invitee who missed the one invitation
	# notification was never told again — and since only an ACTIVE member can
	# see the case, "I invited them and submitted it" and "I have never seen
	# anything" were both true at once. See notify_group_submitted.
	if doc.gdb_cluster:
		notify_group_submitted(user, doc.gdb_cluster, name)
	else:
		_text_received(doc)
	_logger().info(
		f"loan application {name} submitted by {submitted_by or user} for {doc.loan_amount}"
		+ (f" with documents outstanding: {', '.join(outstanding)}" if outstanding else "")
	)
	return _portal_dict(frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True))


def _text_received(doc) -> None:
	"""'We received your application' by SMS (2026-10-05), to the applicant's
	phone. Queued after commit; off until SMS is configured."""
	from gdb_bank.integrations import sms

	first = (frappe.db.get_value("User", doc.gdb_owner, "first_name") or "").strip() or "there"
	phone = doc.applicant_phone_number or frappe.db.get_value("User", doc.gdb_owner, "mobile_no")
	sector = (doc.gdb_sector or "").strip() or "your business"
	sms.send(phone, sms.APPLICATION_RECEIVED.format(first_name=first, sector=sector))


def discard_application(user: str, name: str):
	"""Abandon a draft. Only ever a draft — once submitted it is the Bank record
	of what was asked for, and withdrawal is a decision rather than a delete."""
	_own_draft(name, user)
	frappe.delete_doc("Loan Application", name, ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"draft application {name} discarded by {user}")
	return {"discarded": name}


def apply_loan(
	user: str,
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
	product: str | None = None,
	accept_terms=None,
	credit_check_consent=None,
):
	"""Save and submit in one call, for an applicant with evidence already filed.

	Kept because it is the published contract (docs/openapi.yaml, the Postman
	collection), and because a returning applicant whose identity documents are
	already on their profile has nothing left to attach. It is the two steps
	back to back, gate included: it cannot submit what save_application would
	not have saved, or what submit_application would have refused.
	"""
	draft = save_application(
		user,
		loan_amount,
		purpose,
		term_months,
		monthly_income=monthly_income,
		phone=phone,
		cluster=cluster,
		business_stage=business_stage,
		dcra_number=dcra_number,
		business_name=business_name,
		sections=sections,
		product=product,
	)
	return submit_application(
		user, draft["name"], accept_terms=accept_terms, credit_check_consent=credit_check_consent
	)


# --------------------------------------------------------------------------
# A group's application — prepared and filed by its facilitator
# --------------------------------------------------------------------------


def _group_head(facilitator: str, cluster: str) -> str:
	"""The head the group's application is filed for: an ACTIVE member, and
	never the facilitator under another account."""
	head = frappe.db.get_value("GDB Cluster", cluster, "head")
	if not head:
		frappe.throw(_("Name the group's head before filing its application."))
	if cluster not in _clusters_of(head):
		frappe.throw(_("The group's head is no longer an active member. Name another head."))
	if is_same_person(facilitator, head):
		frappe.throw(_("You cannot file an application for yourself."), frappe.PermissionError)
	return head


def _group_draft(cluster: str, name: str):
	"""This group's open draft, or a refusal."""
	row = frappe.db.get_value(
		"Loan Application", name, ["name", "gdb_owner", "gdb_cluster", "docstatus"], as_dict=True
	)
	if not row or row.gdb_cluster != cluster:
		frappe.throw(_("{0} is not this group's application.").format(name), frappe.PermissionError)
	if cint(row.docstatus) != 0:
		frappe.throw(_("{0} has already been submitted to GDB.").format(name))
	return row


def _group_case(name: str, facilitator: str) -> dict:
	row = frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True)
	return _for_viewer(_portal_dict(row), facilitator)


def save_group_application(
	facilitator: str,
	cluster: str,
	loan_amount,
	purpose: str,
	term_months,
	sections=None,
	name: str | None = None,
):
	"""Create or update the group's DRAFT, filed in its head's name.

	One open draft per group, and saving without `name` while one exists
	updates it rather than opening a second — so a retried first save cannot
	leave two drafts behind. Refused while an earlier application is still with
	the Bank; a group may apply again only after a rejection.

	The head is the lending applicant (a Customer must be a person). Frappe's
	own `owner` on the draft records the facilitator who filed it.
	"""
	cluster = _require_facilitator_of(facilitator, cluster)
	head = _group_head(facilitator, cluster)

	live = frappe.db.get_value(
		"Loan Application",
		{"gdb_cluster": cluster, "docstatus": 1, "status": ["!=", "Rejected"]},
		"name",
	)
	if live:
		frappe.throw(_("This group already has an application with GDB: {0}.").format(live))
	name = name or frappe.db.get_value("Loan Application", {"gdb_cluster": cluster, "docstatus": 0}, "name")

	profile = frappe.db.get_value(
		"GDB Citizen Profile", {"user": head}, ["phone", "verified_phone"], as_dict=True
	)
	values = _validated(
		loan_amount,
		purpose,
		term_months,
		phone=(profile and (profile.phone or profile.verified_phone)) or None,
		sections=sections,
		user=head,
		group=cluster,
	)

	if name:
		row = _group_draft(cluster, name)
		if row.gdb_owner != head:
			frappe.throw(_("The group's head has changed. Discard this draft and start again."))
		doc = frappe.get_doc("Loan Application", name)
		doc.update(values)
	else:
		doc = frappe.get_doc(dict(doctype="Loan Application", **values))
	doc.flags.ignore_permissions = True
	doc.save()
	frappe.db.commit()
	_logger().info(f"group draft {doc.name} for cluster {cluster} saved by facilitator {facilitator}")
	return _group_case(doc.name, facilitator)


def submit_group_application(facilitator: str, cluster: str, name: str):
	"""Put the group's draft before the Bank.

	What the group itself must be is checked here, on the server: a head who is
	still an active member, at least one other member who has ACCEPTED (an
	invitation is not membership, and a group of one is an individual loan), and
	the group's details and the two plan sections an underwriter reads first.
	Documents stay expected-not-blocking, exactly as for a citizen.
	"""
	cluster = _require_facilitator_of(facilitator, cluster)
	row = _group_draft(cluster, name)
	head = _group_head(facilitator, cluster)
	if row.gdb_owner != head:
		frappe.throw(_("The group's head has changed. Discard this draft and start again."))

	if not [m for m in roster_split(cluster)["active"] if not cint(m.is_head)]:
		frappe.throw(_("At least one member besides the head must accept before submitting."))
	group = frappe.db.get_value(
		"GDB Cluster", cluster, ["group_purpose", "region", *REQUIRED_PLAN], as_dict=True
	)
	if not (group.group_purpose or "").strip() or not (group.region or "").strip():
		frappe.throw(_("Complete the group details before submitting."))
	if any(not (group.get(f) or "").strip() for f in REQUIRED_PLAN):
		frappe.throw(_("Complete the executive summary and shared project before submitting."))

	outstanding = missing_evidence(name)
	doc = frappe.get_doc("Loan Application", name)
	doc.flags.ignore_permissions = True
	doc.submit()
	frappe.db.commit()
	notify_group_submitted(head, cluster, name, by=facilitator)
	_logger().info(
		f"group application {name} for cluster {cluster} submitted by facilitator {facilitator} "
		f"in the name of {head} for {doc.loan_amount}"
		+ (f" with documents outstanding: {', '.join(outstanding)}" if outstanding else "")
	)
	return _group_case(name, facilitator)


def discard_group_application(facilitator: str, cluster: str, name: str):
	"""Abandon the group's draft. Never a submitted one."""
	cluster = _require_facilitator_of(facilitator, cluster)
	_group_draft(cluster, name)
	frappe.delete_doc("Loan Application", name, ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"group draft {name} for cluster {cluster} discarded by facilitator {facilitator}")
	return {"discarded": name}


def my_loans(user: str):
	"""The logged-in citizen's applications, newest first."""
	# Every cluster this citizen is in, not one: a member of two groups must
	# see both heads' applications, and `_is_shared_with` below decides which
	# of the rows fetched are actually theirs to read.
	clusters = _clusters_of(user)
	# One query for every group's head, however many groups this citizen is in.
	heads = (
		set(frappe.get_all("GDB Cluster", filters={"name": ["in", clusters]}, pluck="head"))
		if clusters
		else set()
	)
	owners = list({user} | {head for head in heads if head})
	rows = frappe.get_all(
		"Loan Application",
		filters={"gdb_owner": ["in", owners], "docstatus": ["<", 2]},
		fields=LOAN_FIELDS,
		order_by="creation desc",
	)
	eids = _eids([r.gdb_owner for r in rows])
	mine = [r for r in rows if r.gdb_owner == user or _is_shared_with(r, user)]
	ctx = _stage_context([r.name for r in mine])
	return [_for_viewer(_portal_dict(r, eids, ctx), user) for r in mine]


def loan_detail(user: str, name: str):
	row = frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(name))
	# Staff of either kind may read a case; only their own endpoints let them
	# act on it. A draft, though, is nobody's but the applicant's — see
	# all_loans.
	if row.gdb_owner != user and not _is_shared_with(row, user):
		if not _is_staff(user):
			frappe.throw(_("You may only view your own applications."), frappe.PermissionError)
		if cint(row.docstatus) != 1:
			# Said for what it is: telling an officer "your own applications"
			# about somebody else's draft sends them looking for the wrong fault.
			frappe.throw(
				_("{0} is still a draft. It has not been submitted to GDB.").format(name),
				frappe.PermissionError,
			)
	return _for_viewer(_portal_dict(row), user)


def _readable_application(name: str, user: str):
	"""The application row, if this user is allowed to see it."""
	row = frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(name))
	if row.gdb_owner != user and not _is_staff(user) and not _is_shared_with(row, user):
		frappe.throw(_("You may only view your own applications."), frappe.PermissionError)
	return row


def _repayment_history(loan: str) -> list[dict]:
	"""Every payment received against this facility, newest first.

	`gdb_paid_by` has been stamped on each portal repayment since the endpoint
	was written, and until now nothing ever read it back. On a CLUSTER facility
	that omission mattered: one loan carries the whole group, several members
	may pay into it, and a single `total_amount_paid` cannot tell any of them —
	or the head answering for it — who has actually paid. The figure was there
	and the contributions behind it were not.

	Submitted repayments only (docstatus 1). A cancelled repayment is money
	that did not stay received, and showing it as a payment would overstate
	what the group has put in.

	Nothing here computes money: every figure is lending's own row.
	"""
	rows = frappe.get_all(
		"Loan Repayment",
		filters={"against_loan": loan, "docstatus": 1},
		fields=[
			"name",
			"posting_date",
			"amount_paid",
			"principal_amount_paid",
			"repayment_type",
			"gdb_paid_by",
		],
		order_by="posting_date desc, creation desc",
	)
	names = _eids([r.gdb_paid_by for r in rows if r.gdb_paid_by])
	for row in rows:
		payer = row.pop("gdb_paid_by", None)
		# Who paid, as a person rather than a mailbox — the e-ID is how GDB
		# names anybody else in this bank. A receipt applied from Collections
		# has no portal payer at all, and says so.
		row["paid_by_name"] = frappe.utils.get_fullname(payer) if payer else None
		row["paid_by_eid"] = names.get(payer) if payer else None
	return rows


# A statement line is lending's report row as it stands, less the loan and
# currency columns the portal already carries.
STATEMENT_LINE_FIELDS = (
	"transaction_type",
	"transaction_doctype",
	"transaction_name",
	"debit",
	"credit",
	"balance",
	"remarks",
)


def _statement_of_account(loan, to_date) -> list[dict]:
	"""Lending's Loan Statement of Account for this loan, from its booking to `to_date`.

	The report the ERPNext desk shows for a loan, run through Frappe's own report
	endpoint (frappe.desk.query_report.run), so every line and every running
	balance is lending's. It is run from the day the loan was booked, never from
	the period's start: the report's running balance starts at zero on its first
	line, so only a run from the beginning gives a balance that is what is owed.

	Elevated because the report belongs to Loan Manager, a role no portal user
	holds. Who may read this loan has already been settled by
	_readable_application, and the loan is fixed here, never taken from the
	client: the report's own queries skip row-level permissions, so it must not
	be handed a filter a citizen chose.
	"""
	from frappe.desk.query_report import run

	booked = frappe.db.get_value(
		"Loan", loan.name, ["applicant_type", "applicant", "posting_date"], as_dict=True
	)
	# A period that ends before the loan was booked has nothing on it, and the
	# report refuses a run whose start is after its end.
	if getdate(to_date) < getdate(booked.posting_date):
		return []
	with _as_system():
		report = run(
			"Loan Statement of Account",
			filters={
				"company": loan.company,
				"applicant_type": booked.applicant_type,
				"applicant": booked.applicant,
				"loan": loan.name,
				"from_date": str(getdate(booked.posting_date)),
				"to_date": str(getdate(to_date)),
			},
		)
	return [
		{
			"posting_date": str(getdate(line["posting_date"])),
			**{field: line.get(field) for field in STATEMENT_LINE_FIELDS},
		}
		for line in report["result"]
		if isinstance(line, dict)
	]


def _statement(sched: str | None, schedule: list, loan, from_date, to_date) -> dict:
	"""A period's statement: lending's report cut to it, and what falls due in it.

	What happened is lending's Loan Statement of Account for this loan
	(_statement_of_account): every disbursement and payment with lending's
	running balance. The period only decides where it is cut. The opening
	balance is the report's balance on its last line before the period, and the
	closing balance its balance on the last line inside it. Cutting between
	days, never inside one, keeps both right whatever order lending lists one
	day's lines in.

	What is scheduled is kept apart, because a plan is not a receipt: the
	repayment schedule's rows falling due in the period, and their SUM, which
	Frappe's query builder runs over those same rows.
	"""
	start, end = getdate(from_date), getdate(to_date)
	lines = _statement_of_account(loan, end)
	before = [line for line in lines if getdate(line["posting_date"]) < start]
	transactions = [line for line in lines if getdate(line["posting_date"]) >= start]
	opening = flt(before[-1]["balance"]) if before else 0.0
	rows = [r for r in schedule if start <= getdate(r.payment_date) <= end]
	due = (
		frappe.get_all(
			"Repayment Schedule",
			filters={
				"parent": sched,
				"parenttype": "Loan Repayment Schedule",
				"payment_date": ["between", [start, end]],
			},
			fields=[{"SUM": "total_payment", "as": "instalments_due"}],
		)
		if sched
		else []
	)
	return {
		"from_date": str(start),
		"to_date": str(end),
		"transactions": transactions,
		"opening_balance": opening,
		"closing_balance": flt(transactions[-1]["balance"]) if transactions else opening,
		"rows": rows,
		"instalments_due": flt(due[0].instalments_due) if due else 0.0,
	}


def loan_account(user: str, application: str, from_date=None, to_date=None):
	"""Booked loan, repayment schedule and what is left to pay.

	Returns loan: None while the application is still with the underwriter.
	"""
	row = _readable_application(application, user)

	loan = frappe.db.get_value(
		"Loan", {"loan_application": application}, LOAN_ACCOUNT_FIELDS, as_dict=True
	)
	case = _stage_context([application]).get(application) or {}
	approved_amount, approved_term = case.get("approved_amount"), case.get("approved_term")
	# The moratorium the Letter of Offer granted — what booking and release apply.
	moratorium_months = cint(
		frappe.db.get_value(
			"GDB Loan Offer",
			{"application": application, "status": "Accepted", "docstatus": 1},
			"moratorium_months",
		)
	)
	if not loan:
		# Before booking, the terms booking will put into lending: the offer's.
		return {
			"application": application,
			"loan": None,
			"schedule": [],
			"next_due": None,
			"approved_amount": approved_amount,
			"approved_term": approved_term,
			"moratorium_months": moratorium_months,
		}

	# Whether this facility belongs to a group, said plainly rather than
	# inferred from how many people happen to have paid so far. The first
	# payment into a cluster loan needs attributing just as much as the tenth.
	cluster = row.get("gdb_cluster") or None

	schedule = []
	sched = frappe.db.get_value(
		"Loan Repayment Schedule", {"loan": loan.name, "status": "Active"}, "name"
	)
	if sched:
		schedule = frappe.get_all(
			"Repayment Schedule",
			filters={"parent": sched},
			fields=["payment_date", "principal_amount", "interest_amount", "total_payment", "balance_loan_amount"],
			order_by="idx asc",
		)

	# What is owed is lending's answer, never ours. lending.api.get_due_details
	# is the same computation, but it gates on a Loan role no citizen holds and
	# writes into frappe.response instead of returning — so call the function
	# underneath it and relay lending's own keys unchanged.
	from lending.loan_management.doctype.loan_repayment.loan_repayment import calculate_amounts

	# calculate_amounts also asks frappe whether the caller may read the Loan by
	# ROLE. Who may read this loan was settled above (_readable_application) —
	# and an underwriter, whose Loan permissions were revoked with the money
	# roles, still reads back the Quick Loan they decide and pay. Elevated for
	# the arithmetic only; nothing here writes.
	with _as_system():
		amounts = calculate_amounts(loan.name, nowdate())
	dues = {
		"overdue_penalty_amount": amounts.get("penalty_amount"),
		"overdue_interest_amount": amounts.get("interest_amount"),
		"overdue_principal_amount": amounts.get("payable_principal_amount"),
		"principal_outstanding": amounts.get("pending_principal_amount"),
		"overdue_total_amount": amounts.get("payable_amount"),
		"applicable_future_interest": amounts.get("unaccrued_interest"),
		"unbooked_interest": amounts.get("unbooked_interest"),
		"oldest_due_date": amounts.get("due_date"),
		"overdue_charges": amounts.get("total_charges_payable"),
		"written_off_amount": amounts.get("written_off_amount"),
		"excess_amount_paid": amounts.get("excess_amount_paid"),
	}

	# What is still drawable is lending's answer too, and only the bank is shown
	# it. get_disbursal_amount nets off adjustments, refunds and write-offs,
	# honours a Line of Credit limit and returns 0 while a secured loan is in
	# security shortfall - none of which a loan_amount - disbursed_amount
	# subtraction would catch. Elevated because it gates on a Loan permission
	# portal roles do not hold, and it takes a row lock (for_update), so it is
	# computed only for the underwriter who is about to act on it.
	disbursable = None
	if _is_staff(user):
		from lending.loan_management.doctype.loan_disbursement.loan_disbursement import (
			get_disbursal_amount,
		)

		with _as_system():
			# Returns (disbursal_amount, pending_principal_amount) — unpack it;
			# flt() on the raw tuple silently yields 0.0.
			disbursable = flt(get_disbursal_amount(loan.name)[0])

	return {
		"application": application,
		"loan": loan,
		"schedule": schedule,
		"dues": dues,
		"disbursable": disbursable,
		# The instalment lending bills is the current schedule's; the Loan's own
		# monthly_repayment_amount is the figure at booking, which lending never
		# revises when a smaller amount is released or a tranche is added.
		"instalment": _schedule_instalments([loan.name]).get(loan.name)
		or flt(loan.monthly_repayment_amount),
		# The underwriter's decision, and whether lending was booked on it. False
		# only for a Loan booked before book_loan took the offer's terms: its
		# drawable ceiling is the requested amount, and release refuses it.
		"approved_amount": approved_amount,
		"approved_term": approved_term,
		"moratorium_months": moratorium_months,
		"booked_on_offer": None
		if approved_amount is None
		else (
			flt(loan.loan_amount) == flt(approved_amount)
			and cint(loan.repayment_periods) == cint(approved_term)
		),
		"statement": _statement(sched, schedule, loan, from_date, to_date)
		if from_date and to_date
		else None,
		"cluster": cluster,
		"payments": _repayment_history(loan.name),
	}
