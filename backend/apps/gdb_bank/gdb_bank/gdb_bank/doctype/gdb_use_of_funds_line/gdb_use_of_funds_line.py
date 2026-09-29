"""GDB Use Of Funds Line — one line of an application's declared use of funds.

A child table on Loan Application (Custom Field gdb_use_of_funds_lines), so each
line's amount is a real Currency column Frappe can SUM. It replaces the JSON
text the lines used to be packed into, which no query could total.
"""

from frappe.model.document import Document


class GDBUseOfFundsLine(Document):
	pass
