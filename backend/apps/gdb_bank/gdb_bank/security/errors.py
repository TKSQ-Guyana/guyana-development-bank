"""Error taxonomy (CLAUDE.md section 5).

The frontend never sees a stack trace, a SQL fragment or a Keycloak internal.
It sees `{"code": "...", "message": "...", "details": {...}}` with an HTTP
status chosen from the table below.

Frappe renders whitelisted-method exceptions through `_server_messages`; we set
`frappe.local.response["http_status_code"]` and attach a machine-readable
`gdb_error` payload alongside so the SPA can branch on a code rather than parse
English.
"""

from __future__ import annotations

import frappe
from frappe import _


class GdbError(frappe.ValidationError):
	"""Base for every error this app raises deliberately.

	WHY `http_status_code` EXISTS ALONGSIDE `http_status`
	    Frappe reads the status off the EXCEPTION CLASS, not off the response
	    dict: `frappe/app.py` does `getattr(e, "http_status_code", 500)` in
	    `handle_exception`. The `frappe.local.response["http_status_code"]`
	    that `throw()` sets below is only consulted on the SUCCESS path
	    (`frappe/utils/response.py`), and that path is never reached once
	    `frappe.throw` has raised.

	    So for a while every error in this taxonomy went out as **417** - the
	    value `frappe.ValidationError` carries - no matter what `http_status`
	    said. A 401 that arrives as 417 is not cosmetic: `auth.tsx` branches on
	    `status === 401 || status === 403` to tell "not signed in" from a real
	    fault, and that condition could never be true, so every ordinary
	    logged-out state was reported to the console as a failure.

	    `http_status` is kept as the readable name this module is written in;
	    `__init_subclass__` mirrors it onto the name Frappe reads, so a new
	    subclass cannot forget and silently inherit 417.
	"""

	code = "GDB_ERROR"
	http_status = 400
	http_status_code = 400

	def __init_subclass__(cls, **kwargs) -> None:
		super().__init_subclass__(**kwargs)
		cls.http_status_code = cls.http_status


class AuthenticationRequired(GdbError):
	code = "AUTH_REQUIRED"
	http_status = 401


class NotAuthorized(GdbError):
	code = "NOT_AUTHORIZED"
	http_status = 403


class SeparationOfDutiesViolation(NotAuthorized):
	code = "SEPARATION_OF_DUTIES"
	http_status = 403


class ResourceNotFound(GdbError):
	code = "NOT_FOUND"
	http_status = 404


class InvalidState(GdbError):
	code = "INVALID_STATE"
	http_status = 409


class ConcurrencyConflict(GdbError):
	code = "STALE_VERSION"
	http_status = 409


class IdempotencyConflict(GdbError):
	code = "IDEMPOTENCY_CONFLICT"
	http_status = 409


class ValidationFailed(GdbError):
	code = "VALIDATION_FAILED"
	http_status = 422


class UpstreamUnavailable(GdbError):
	code = "UPSTREAM_UNAVAILABLE"
	http_status = 503


def throw(
	error: type[GdbError],
	message: str,
	**details,
) -> None:
	"""Raise a taxonomy error with a machine-readable payload attached.

	`details` must never carry PII - it is for codes, ids and counts that help
	the SPA render a precise message (e.g. `expected_version=17`).
	"""
	frappe.local.response["gdb_error"] = {
		"code": error.code,
		"message": message,
		"details": details or {},
	}
	frappe.local.response["http_status_code"] = error.http_status
	frappe.throw(_(message), error)
