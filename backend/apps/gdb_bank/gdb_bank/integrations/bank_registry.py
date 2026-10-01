"""Bank account discovery and verification.

GDB pays approved loans into an account the citizen already holds at a
commercial bank. Two things have to be true before a payment instruction is
worth issuing: the account exists, and it is in the applicant's own name.
Asking the applicant to type the number proves neither — a transposed digit
and a relative's account look exactly alike on a form.

So the portal asks the national payment switch instead: given the applicant's
e-ID, which accounts are held in their name? They pick one. The number is never
typed, which is also why they cannot nominate somebody else's account.

This module is the *adapter* for the real switch (contract in
docs/integrations/bank-account-verification.md), shaped exactly like
`integrations/dcra.py`. It holds no data of its own. It is switched on by
configuration alone — `bank_registry_base_url`, and `bank_registry_api_key` if
the switch issues one (integrations/settings.py). Two public functions:

  accounts_for(eid) — the accounts the switch says this person holds
  verify(bank, account_no, full_name) — confirm one account and its name match

Every result carries `source`:

  bank_registry — the switch answered
  unavailable   — the switch is not configured, or did not respond

An account the adapter cannot confirm comes back as `status: "Unavailable"` —
never as a pass. plan.md §6.1 names that rule for every external check:
unavailable is a distinct state, and it must not be converted into a pass.
"""

from __future__ import annotations

from gdb_bank.integrations import client

SYSTEM = "bank_registry"


def normalize(account_number: str | None) -> str:
	"""Account numbers are quoted with spaces and dashes; store one form."""
	return "".join(ch for ch in (account_number or "") if ch.isdigit())


def mask(account_number: str | None) -> str:
	"""Last four only. What a log line or an underwriter's screen may carry."""
	number = normalize(account_number)
	return f"****{number[-4:]}" if len(number) > 4 else "****"


def names_match(claimed: str | None, on_account: str | None) -> bool:
	"""Is the account in the applicant's own name?

	Deliberately forgiving about word order and punctuation and nothing else:
	banks hold "PERSAUD, ASHA" for the person GDB knows as "Asha Persaud", and
	that is a match. A middle name the bank holds and GDB does not is also a
	match. Anything beyond that is a human's call, not this function's — a near
	miss returns False and the case goes to review rather than through it.
	"""

	def tokens(name: str | None) -> set[str]:
		cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in (name or ""))
		return {t.casefold() for t in cleaned.split() if len(t) > 1}

	claimed_tokens, account_tokens = tokens(claimed), tokens(on_account)
	if not claimed_tokens or not account_tokens:
		return False
	return claimed_tokens <= account_tokens or account_tokens <= claimed_tokens


def _unavailable(bank: str, account_no: str, reason: str) -> dict:
	"""The switch could not answer. Distinct from 'no such account'."""
	return {
		"bank": bank,
		"account_number": account_no,
		"account_name": None,
		"status": "Unavailable",
		"name_match": None,
		"source": "unavailable",
		"reason": reason,
	}


def accounts_for(eid: str | None) -> list[dict]:
	"""Every account the switch says this person holds.

	This is what lets the portal fill the payout destination in rather than
	asking for it. It is also the anti-misdirection control: an applicant can
	only pick from accounts the switch says are theirs, so nominating somebody
	else's account is not a thing the form can express.

	An e-ID is required. A user who has never linked one has nothing to key the
	search on, so they type the account themselves and `verify` checks what they
	typed. A switch that is not configured or does not answer yields nothing,
	for the same manual path — never a fabricated account.
	"""
	key = (eid or "").strip()
	if not key:
		return []

	status, payload = client.get_json(SYSTEM, "/accounts", {"national_id": key})
	if status != 200:
		return []

	rows = payload.get("accounts") if isinstance(payload, dict) else payload
	return [{**row, "source": "bank_registry"} for row in (rows or [])]


def verify(bank: str, account_number: str, full_name: str | None = None) -> dict:
	"""Confirm one nominated account, and whether it is in the applicant's name.

	Always returns a dict carrying `source`, one of:
	  bank_registry — the switch answered
	  unavailable   — the switch could not be reached, or is not configured

	and `status`, one of Active / Dormant / Closed / Not Found / Unavailable.
	`name_match` is True, False, or None when there was no name to compare.
	"""
	number = normalize(account_number)
	bank = (bank or "").strip()
	if not number:
		return _unavailable(bank, number, "no account number given")
	if not client.configured(SYSTEM):
		return _unavailable(bank, number, "bank registry is not configured")

	# `number` is digits only (normalize), so it is safe in the path as it is.
	status, payload = client.get_json(SYSTEM, f"/accounts/{number}", {"bank": bank})

	if status == 404:
		record = {
			"bank": bank,
			"account_number": number,
			"account_name": None,
			"status": "Not Found",
			"source": "bank_registry",
		}
	elif status != 200 or not isinstance(payload, dict):
		return _unavailable(bank, number, "bank registry did not respond")
	else:
		record = {
			"bank": payload.get("bank") or bank,
			"account_number": payload.get("account_number") or number,
			"account_name": payload.get("account_name"),
			"branch_code": payload.get("branch_code"),
			"account_type": payload.get("account_type"),
			"status": payload.get("status"),
			"reference": payload.get("reference"),
			"source": "bank_registry",
		}

	record["name_match"] = names_match(full_name, record.get("account_name")) if full_name else None
	return record
