"""GDB KYC Record — one person as the KYC register holds them.

What sign-up reads when someone types their TIN (integrations/kyc_registry): it
fills their names and date of birth, and sends the sign-up code to the phone on
record, which the form only ever sees masked. Loaded from the register's own
export (one row per person, its `profile_id` the record's name), and readable
here so staff can see and correct what the portal is prefilling from.

Real people's identity numbers, phones and bank accounts: System Manager only,
read by loan officers. Never given to the Citizen role.
"""

from frappe.model.document import Document


class GDBKYCRecord(Document):
	pass
