"""GDB Bank Branch — one branch of a bank a citizen may be paid through.

Seeded (install.BANK_BRANCHES) with each branch's routing transit number, which
is what a payout's Bank Account carries as its branch code. The portal offers a
bank's branches as a list instead of a free-text box, so a payment instruction
never names a branch the bank does not have.
"""

from frappe.model.document import Document


class GDBBankBranch(Document):
	pass
