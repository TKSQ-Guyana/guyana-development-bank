"""The business audit trail (CLAUDE.md section 5).

Technical logs answer "what did the server do?". This answers the questions an
auditor asks: *who, what changed, old value, new value, when, why, which
transition* - and, for Phase 2.5, *on whose behalf*.

The trail is append-only and is the substrate the separation-of-duties engine
queries, so writing it is not optional decoration: skipping a `record()` call
on an approval silently disables the maker/checker rule that depends on it.
That is why every state transition goes through `services/` and every service
records.
"""

from __future__ import annotations

import frappe

from gdb_bank.repositories.audit import AUDIT_DOCTYPE
from gdb_bank.security.session import Actor

_MAX_VALUE_CHARS = 8000


def record(
	actor: Actor,
	event: str,
	*,
	subject_doctype: str = "",
	subject_name: str = "",
	reason: str | None = None,
	old_value=None,
	new_value=None,
	workflow_from: str | None = None,
	workflow_to: str | None = None,
	on_behalf_of_eid: str | None = None,
) -> str:
	"""Append one business event. Returns the audit row name.

	Written inside the caller's transaction on purpose: if the business change
	rolls back, its audit row must roll back with it, or the trail would claim
	something happened that did not. (Security denials are the exception - see
	`rbac/guards._write_security_event`, which commits separately precisely
	because the request it describes is about to roll back.)
	"""
	doc = frappe.get_doc(
		{
			"doctype": AUDIT_DOCTYPE,
			"event": event,
			"actor_user": actor.user,
			"actor_eid": actor.eid,
			"actor_persona": ",".join(actor.persona_keys),
			"on_behalf_of_eid": on_behalf_of_eid,
			"subject_doctype": subject_doctype,
			"subject_name": subject_name,
			"reason": (reason or "").strip() or None,
			"old_value": _encode(old_value),
			"new_value": _encode(new_value),
			"workflow_from": workflow_from,
			"workflow_to": workflow_to,
			"request_id": getattr(frappe.local, "request_id", None),
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc.name


def record_transition(
	actor: Actor,
	event: str,
	doctype: str,
	name: str,
	from_state: str,
	to_state: str,
	*,
	reason: str | None = None,
	on_behalf_of_eid: str | None = None,
) -> str:
	"""The common case: a document moved along the lifecycle."""
	return record(
		actor,
		event,
		subject_doctype=doctype,
		subject_name=name,
		reason=reason,
		workflow_from=from_state,
		workflow_to=to_state,
		on_behalf_of_eid=on_behalf_of_eid,
	)


def _encode(value) -> str | None:
	"""Serialise a value for the trail.

	Truncated rather than unbounded: an audit row is a record of a change, not
	a second copy of the document, and an oversized blob turns the trail into
	a place PII accumulates unnoticed.
	"""
	if value is None:
		return None
	if isinstance(value, str):
		encoded = value
	else:
		encoded = frappe.as_json(value)
	if len(encoded) > _MAX_VALUE_CHARS:
		return encoded[:_MAX_VALUE_CHARS] + "...[truncated]"
	return encoded
