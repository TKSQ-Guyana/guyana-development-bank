"""Bank account discovery and verification.

GDB pays approved loans into an account the citizen already holds at a
commercial bank. Two things have to be true before a payment instruction is
worth issuing: the account exists, and it is in the applicant's own name.
Asking the applicant to type the number proves neither — a transposed digit
and a relative's account look exactly alike on a form.

So the portal asks the national payment switch instead: given the applicant's
e-ID, which accounts are held in their name? They pick one. The number is never
typed, which is also why they cannot nominate somebody else's account.

This module is the *adapter*, shaped exactly like `integrations/dcra.py`. Two
public functions:

  accounts_for(eid, full_name) — the accounts the switch says are this person's
  verify(bank, account_no, full_name) — confirm one account and its name match

and two implementations behind each:

  live     — HTTP to the switch, used when the site is configured with
             `bank_registry_base_url` (contract in
             docs/integrations/bank-account-verification.md).
  sandbox  — a small fixed register used until that service exists.

Every result carries `source`, and `sandbox` is never evidence. An account the
adapter cannot confirm comes back as `status: "Unavailable"` — never as a pass.
plan.md §6.1 names that rule for every external check: unavailable is a
distinct state, and it must not be converted into a pass.
"""

from __future__ import annotations

import logging

import frappe

_HTTP_TIMEOUT = 10

# Sandbox register. Stand-ins keyed by e-ID, used only until the switch exists —
# `source` says "sandbox" on every one so nothing downstream can mistake them
# for a bank's confirmation. The bank names match the Bank records seeded by
# install.ensure_banks, because a nominated account has to name a bank GDB can
# actually pay.
SANDBOX_REGISTER: dict[str, list[dict]] = {
	# Two accounts, so the portal's "which one?" path is exercised by the
	# default demo login rather than only by a hand-built case.
	"592-1111-0001": [
		{
			"bank": "Citizens Bank Guyana",
			"account_number": "0009111122223333",
			"account_name": "Demo Citizen",
			"branch_code": "CTZ-NA-07",
			"account_type": "Savings",
			"status": "Active",
		},
		{
			"bank": "Demerara Bank",
			"account_number": "0001222233334444",
			"account_name": "Demo Citizen",
			"branch_code": "DEM-GT-04",
			"account_type": "Current",
			"status": "Active",
		},
	],
	"592-2222-0002": [
		{
			"bank": "Demerara Bank",
			"account_number": "0001777788889999",
			"account_name": "GDB Underwriter",
			"branch_code": "DEM-GT-04",
			"account_type": "Savings",
			"status": "Active",
		},
	],
	"592-3333-0003": [
		{
			"bank": "Citizens Bank Guyana",
			"account_number": "0009000087654321",
			"account_name": "Asha Persaud",
			"branch_code": "CTZ-NA-07",
			"account_type": "Savings",
			"status": "Active",
		},
		# A dormant account is deliberately included: it exists and the name
		# matches, and it still cannot receive a disbursement. An underwriter
		# and a Disbursement Officer both need to be able to see that state,
		# and the flow has to handle it — the same reason DCRA's sandbox
		# carries a struck-off registration.
		{
			"bank": "Republic Bank (Guyana)",
			"account_number": "0004555566667777",
			"account_name": "Asha Persaud",
			"branch_code": "RBL-GT-01",
			"account_type": "Savings",
			"status": "Dormant",
		},
	],
	"592-4444-0004": [
		{
			"bank": "Demerara Bank",
			"account_number": "0001445566778",
			"account_name": "Hemanth Narine",
			"branch_code": "DEM-GT-04",
			"account_type": "Current",
			"status": "Active",
		},
	],
}


def _logger() -> logging.Logger:
	logger = frappe.logger("gdb_bank", allow_site=True)
	logger.setLevel(logging.INFO)
	return logger


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


def _live_accounts(eid: str, base_url: str) -> list[dict] | None:
	"""Ask the switch which accounts this e-ID holds."""
	import requests

	try:
		res = requests.get(
			f"{base_url.rstrip('/')}/accounts",
			params={"national_id": eid},
			headers={"Accept": "application/json"},
			timeout=_HTTP_TIMEOUT,
		)
	except requests.RequestException as exc:
		_logger().error(f"bank registry unreachable: {exc}")
		return None

	if res.status_code != 200:
		_logger().error(f"bank registry account search returned {res.status_code}")
		return None

	payload = res.json()
	rows = payload.get("accounts") if isinstance(payload, dict) else payload
	return [{**r, "source": "bank_registry"} for r in (rows or [])]


def _live_verify(bank: str, account_no: str, base_url: str) -> dict | None:
	"""Confirm one account at the switch. Contract in the docs."""
	import requests

	try:
		res = requests.get(
			f"{base_url.rstrip('/')}/accounts/{account_no}",
			params={"bank": bank},
			headers={"Accept": "application/json"},
			timeout=_HTTP_TIMEOUT,
		)
	except requests.RequestException as exc:
		_logger().error(f"bank registry unreachable: {exc}")
		return None

	if res.status_code == 404:
		return {
			"bank": bank,
			"account_number": account_no,
			"account_name": None,
			"status": "Not Found",
			"source": "bank_registry",
		}
	if res.status_code != 200:
		_logger().error(f"bank registry returned {res.status_code} for {mask(account_no)}")
		return None

	payload = res.json()
	return {
		"bank": payload.get("bank") or bank,
		"account_number": payload.get("account_number") or account_no,
		"account_name": payload.get("account_name"),
		"branch_code": payload.get("branch_code"),
		"account_type": payload.get("account_type"),
		"status": payload.get("status"),
		"reference": payload.get("reference"),
		"source": "bank_registry",
	}


def accounts_for(eid: str | None, full_name: str | None = None) -> list[dict]:
	"""Every account the switch says is held in this person's name.

	This is what lets the portal fill the payout destination in rather than
	asking for it. It is also the anti-misdirection control: an applicant can
	only pick from accounts the switch says are theirs, so nominating somebody
	else's account is not a thing the form can express.

	An e-ID is required. A user who has never linked one has nothing to key the
	search on, so they type the account themselves and `verify` checks what they
	typed.
	"""
	key = (eid or "").strip()
	if not key:
		return []

	base_url = frappe.conf.get("bank_registry_base_url")
	if base_url:
		live = _live_accounts(key, base_url)
		# An unreachable switch yields nothing rather than sandbox data — the
		# caller shows the manual fallback, never a fabricated account.
		return live or []

	rows = SANDBOX_REGISTER.get(key, [])
	# The switch answers for the e-ID; the name check still runs here, because
	# an account that is not in the applicant's name must not be offered as
	# theirs even by a stand-in register.
	return [
		{**row, "source": "sandbox"}
		for row in rows
		if not full_name or names_match(full_name, row.get("account_name"))
	]


def verify(bank: str, account_number: str, full_name: str | None = None) -> dict:
	"""Confirm one nominated account, and whether it is in the applicant's name.

	Always returns a dict carrying `source`, one of:
	  bank_registry — the switch answered
	  sandbox       — the stand-in register answered; NOT evidence
	  unavailable   — the switch could not be reached, or is not configured

	and `status`, one of Active / Dormant / Closed / Not Found / Unavailable.
	`name_match` is True, False, or None when there was no name to compare.
	"""
	number = normalize(account_number)
	bank = (bank or "").strip()
	if not number:
		return _unavailable(bank, number, "no account number given")

	base_url = frappe.conf.get("bank_registry_base_url")
	if base_url:
		live = _live_verify(bank, number, base_url)
		# A configured-but-unreachable switch is unavailable. It must never
		# fall through to the sandbox and look like a confirmation.
		if live is None:
			return _unavailable(bank, number, "bank registry did not respond")
		record = live
	else:
		found = next(
			(
				row
				for rows in SANDBOX_REGISTER.values()
				for row in rows
				if normalize(row["account_number"]) == number
				and (not bank or row["bank"] == bank)
			),
			None,
		)
		if not found:
			return {
				"bank": bank,
				"account_number": number,
				"account_name": None,
				"status": "Not Found",
				"name_match": None,
				"source": "sandbox",
			}
		record = {**found, "source": "sandbox"}

	record["name_match"] = names_match(full_name, record.get("account_name")) if full_name else None
	return record
