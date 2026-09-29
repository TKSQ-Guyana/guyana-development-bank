"""Programme policy: the terms GDB lends on, read from configuration.

project_overview.md §29 names hard-coded policy values as an incorrect
implementation, and the rate of interest is the clearest case of why. It is a
ministerial decision about a national programme, announced publicly and
revisable by people who do not deploy software. A constant in install.py makes
changing it a code release, and — as a fresh GDB site proved — makes the live
rate depend on whether a particular migrate hook happened to run.

One resolver, first non-empty wins:

  1. site_config.json — how a deployed site pins a value with no container change
  2. the environment  — how docker compose passes it
  3. the default below — the programme as announced: zero interest

Deliberately NOT a doctype the portal can edit. Setting the rate a citizen
repays at is a credit decision, and no portal role holds credit authority over
the programme's own terms — utils/constants keeps the Platform Admin out of
every authority set precisely so the person who administers accounts cannot
also price the loan book. Changing this is a deployment action, and it carries
whatever audit trail the deployment itself has.

A value that cannot be read as a rate is REFUSED and the default stands. That
direction is deliberate: 0 is the announced rate and the only one that can
never overcharge a borrower, so a typo in a config file costs GDB margin it
never had rather than costing a citizen money. The refusal is logged at ERROR
so it is visible rather than silent.
"""

import logging
import os

import frappe


def _logger() -> logging.Logger:
	"""The app logger, spelled out here rather than imported from utils.session.

	This module is read by install.py at import time, and utils.constants —
	which session pulls in — imports install for APPLICATION_SECTIONS. Reusing
	session's logger would close that loop and leave install half-initialised,
	so policy stays a leaf that depends on nothing but frappe.
	"""
	logger = frappe.logger("gdb_bank", allow_site=True)
	logger.setLevel(logging.INFO)
	return logger

# site_config key -> environment variable.
RATE_KEY = "gdb_rate_of_interest"
RATE_ENV = "GDB_RATE_OF_INTEREST"

# The programme as announced: zero interest, so a borrower repays what they
# borrowed and nothing more.
DEFAULT_RATE = 0.0

# A rate at or above this is a typo, not a policy — refuse it rather than
# compute a schedule from it.
MAX_RATE = 100.0


def _configured() -> tuple[str, str | None]:
	"""(raw value, source) straight from configuration, unvalidated."""
	value = str(frappe.conf.get(RATE_KEY) or "").strip()
	if value:
		return value, "site_config"
	value = (os.environ.get(RATE_ENV) or "").strip()
	if value:
		return value, "environment"
	return "", None


def _parse(value: str) -> float | None:
	"""The value as a rate, or None if it is not one GDB may lend at."""
	try:
		rate = float(value)
	except (TypeError, ValueError):
		return None
	if rate < 0 or rate >= MAX_RATE:
		return None
	return rate


def resolve() -> tuple[float, str]:
	"""(rate, source) — source is site_config, environment or default."""
	value, source = _configured()
	if not value:
		return DEFAULT_RATE, "default"

	rate = _parse(value)
	if rate is None:
		_logger().error(
			f"{RATE_KEY} from {source} is not a rate GDB may lend at ({value!r}) — "
			f"refusing it and using {DEFAULT_RATE}%"
		)
		return DEFAULT_RATE, "default"
	return rate, source


def rate_of_interest() -> float:
	"""The rate every GDB loan product and schedule is priced at."""
	return resolve()[0]


def source() -> str:
	"""Which of the three answered: site_config, environment or default."""
	return resolve()[1]
