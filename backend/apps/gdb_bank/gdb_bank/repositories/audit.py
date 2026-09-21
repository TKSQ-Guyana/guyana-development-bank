"""Reads over the `GDB Audit Event` trail.

Kept in `repositories/` rather than `services/` so the separation-of-duties
guard can query the trail without importing a service (and creating a cycle:
services are guarded, guards would import services).

The trail is append-only. Nothing in this app updates or deletes an audit row;
the DocType grants no write or delete permission to any persona.
"""

from __future__ import annotations

import frappe

AUDIT_DOCTYPE = "GDB Audit Event"


def actors_of(subject_doctype: str, subject_name: str, event_types) -> set[str]:
	"""Every user recorded as having performed one of `event_types` on the
	subject. This is the question separation of duties actually asks."""
	if not subject_name or not event_types:
		return set()
	rows = frappe.get_all(
		AUDIT_DOCTYPE,
		filters={
			"subject_doctype": subject_doctype,
			"subject_name": subject_name,
			"event": ("in", list(event_types)),
		},
		pluck="actor_user",
		ignore_permissions=True,
	)
	return {r for r in rows if r}


def events_for(subject_doctype: str, subject_name: str, limit: int = 200) -> list[dict]:
	return frappe.get_all(
		AUDIT_DOCTYPE,
		filters={"subject_doctype": subject_doctype, "subject_name": subject_name},
		fields=[
			"name",
			"event",
			"actor_user",
			"actor_eid",
			"actor_persona",
			"on_behalf_of_eid",
			"reason",
			"old_value",
			"new_value",
			"workflow_from",
			"workflow_to",
			"creation",
		],
		order_by="creation asc",
		limit=limit,
		ignore_permissions=True,
	)


def decisions_by(actor_user: str, event_types, limit: int = 200) -> list[dict]:
	"""An officer's own decision history (features.md, underwriter)."""
	return frappe.get_all(
		AUDIT_DOCTYPE,
		filters={"actor_user": actor_user, "event": ("in", list(event_types))},
		fields=[
			"name",
			"event",
			"subject_doctype",
			"subject_name",
			"reason",
			"creation",
		],
		order_by="creation desc",
		limit=limit,
		ignore_permissions=True,
	)
