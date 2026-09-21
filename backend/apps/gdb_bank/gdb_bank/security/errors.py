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
	"""Base for every error this app raises deliberately."""

	code = "GDB_ERROR"
	http_status = 400


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
