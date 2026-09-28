"""Who the applicant is, in two blocks that are never merged.

The upper block is what the e-ID directory asserted at sign-in. The lower block
is what the applicant typed. They are kept apart on purpose: a phone number the
directory holds and a phone number the applicant gave are different kinds of
fact, and an underwriter deciding a loan is entitled to see which is which. A
single "phone" field that silently prefers one source would answer a question
nobody asked and hide the one that matters.
"""

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt

from gdb_bank.utils.constants import PERSONAL_FINANCIAL_MONEY

DOCTYPE = "GDB Citizen Profile"


def canonical_region(value: str | None) -> str | None:
	"""The region exactly as the list spells it, matched on its number.

	A region can arrive with a hyphen instead of the list's dash (DCRA writes
	one), or with the dash lost to a wrong text encoding. Neither may be
	stored: an off-list value makes every later save of the profile fail.
	"""
	value = (value or "").strip()
	if not value:
		return None
	options = [o for o in frappe.get_meta(DOCTYPE).get_field("region").options.split("\n") if o]
	if value in options:
		return value
	number = re.match(r"region\s+(\d+)\b", value, re.IGNORECASE)
	if number:
		return next((o for o in options if o.startswith(f"Region {number.group(1)} ")), value)
	return value


class GDBCitizenProfile(Document):
	def validate(self):
		self.full_name = frappe.utils.get_fullname(self.user)
		if not self.eid:
			self.eid = frappe.db.get_value("User", self.user, "gdb_eid")
		self.updated_on = frappe.utils.now_datetime()
		self.validate_region()
		self.validate_financials()

	def validate_region(self):
		self.region = canonical_region(self.region)
		options = self.meta.get_field("region").options.split("\n")
		if self.region and self.region not in options:
			frappe.throw(_("Choose your region from the list."))

	def validate_financials(self):
		"""Declared figures are amounts, so none of them may be negative."""
		for field in PERSONAL_FINANCIAL_MONEY:
			if flt(self.get(field)) < 0:
				frappe.throw(_("{0} cannot be negative.").format(_(self.meta.get_label(field))))
		if cint(self.dependents) < 0:
			frappe.throw(_("Dependents cannot be negative."))
