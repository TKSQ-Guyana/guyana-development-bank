"""The authorization gate every service function passes through.

Two checks, in order:

    1. CAPABILITY - does the actor's persona set grant this capability?
    2. SEPARATION  - has this actor already played the conflicting part on this
       specific subject? (`rbac/separation.py`, evaluated against the audit
       trail.)

Both are registry-driven. A new persona changes step 1 by appearing in
`personas.PERSONAS`; a new maker/checker constraint changes step 2 by appearing
in `separation.RULES`. Neither requires touching a service.

USAGE

    @require(cap.CREDIT_APPROVE, subject_doctype=APPLICATION, subject_arg="name")
    def approve(name: str, ...): ...

`subject_arg` names the parameter carrying the subject's primary key; the
decorator resolves it from either positional or keyword arguments so the
separation rules can be evaluated before the body runs.
"""

from __future__ import annotations

import functools
import inspect
from collections.abc import Callable, Iterable

import frappe

from gdb_bank.domain import events as ev
from gdb_bank.rbac import separation
from gdb_bank.repositories import audit as audit_repo
from gdb_bank.security import errors
from gdb_bank.security.session import Actor, current_actor


def has(actor: Actor, capability: str) -> bool:
	return capability in actor.capabilities


def assert_capability(actor: Actor, capability: str) -> None:
	if capability in actor.capabilities:
		return
	_record_denial(actor, capability)
	errors.throw(
		errors.NotAuthorized,
		"Your role does not permit this action.",
		capability=capability,
	)


def assert_separation(
	actor: Actor,
	capability: str,
	subject_doctype: str | None,
	subject_name: str | None,
	subject_parties: Iterable[str] = (),
) -> None:
	"""Refuse if the actor already played a conflicting part on this subject.

	`subject_parties` are the users connected to the subject other than through
	the audit trail (applicant, co-applicants, facilitator); rules that set
	`include_subject_party` also refuse those.
	"""
	rules = separation.rules_for(capability)
	if not rules or not subject_doctype or not subject_name:
		return

	parties = {p for p in subject_parties if p}
	for rule in rules:
		conflicted = audit_repo.actors_of(subject_doctype, subject_name, rule.conflicting_events)
		if rule.include_subject_party:
			conflicted |= parties
		if actor.user in conflicted:
			_record_separation_block(actor, rule, subject_doctype, subject_name)
			errors.throw(
				errors.SeparationOfDutiesViolation,
				rule.message,
				rule=rule.rule_id,
				capability=capability,
			)


def require(
	capability: str,
	*,
	subject_doctype: str | None = None,
	subject_arg: str | None = None,
	parties: Callable[[str], Iterable[str]] | None = None,
):
	"""Decorate a service function with its capability and separation checks.

	The wrapped function receives the resolved `Actor` as the keyword argument
	`actor` when it declares one, so it never re-derives the session.
	"""

	def decorator(fn):
		signature = inspect.signature(fn)
		wants_actor = "actor" in signature.parameters

		@functools.wraps(fn)
		def wrapper(*args, **kwargs):
			actor = kwargs.pop("actor", None) or current_actor()
			assert_capability(actor, capability)

			subject_name = None
			if subject_arg:
				bound = signature.bind_partial(*args, **kwargs)
				subject_name = bound.arguments.get(subject_arg)

			if subject_name and capability in separation.GUARDED_CAPABILITIES:
				assert_separation(
					actor,
					capability,
					subject_doctype,
					str(subject_name),
					parties(str(subject_name)) if parties else (),
				)

			if wants_actor:
				kwargs["actor"] = actor
			return fn(*args, **kwargs)

		wrapper.__gdb_capability__ = capability
		wrapper.__gdb_subject_doctype__ = subject_doctype
		return wrapper

	return decorator


def require_any(*capabilities: str):
	"""For read endpoints a couple of personas reach by different routes (a case
	summary readable by its owner, its facilitator, or an underwriter)."""

	def decorator(fn):
		signature = inspect.signature(fn)
		wants_actor = "actor" in signature.parameters

		@functools.wraps(fn)
		def wrapper(*args, **kwargs):
			actor = kwargs.pop("actor", None) or current_actor()
			if not any(c in actor.capabilities for c in capabilities):
				_record_denial(actor, "|".join(capabilities))
				errors.throw(
					errors.NotAuthorized,
					"Your role does not permit this action.",
					capability=list(capabilities),
				)
			if wants_actor:
				kwargs["actor"] = actor
			return fn(*args, **kwargs)

		wrapper.__gdb_capability__ = capabilities
		return wrapper

	return decorator


# ---------------------------------------------------------------------------
# Denial telemetry. Technical log only - no PII, per CLAUDE.md section 5.
# ---------------------------------------------------------------------------


def _record_denial(actor: Actor, capability: str) -> None:
	frappe.logger("gdb_bank", allow_site=True).warning(
		f"authz denied capability={capability} personas={','.join(actor.persona_keys) or 'none'}"
	)
	_write_security_event(actor, ev.ACCESS_DENIED, reason=f"capability={capability}")


def _record_separation_block(
	actor: Actor, rule, subject_doctype: str, subject_name: str
) -> None:
	frappe.logger("gdb_bank", allow_site=True).warning(
		f"separation-of-duties blocked rule={rule.rule_id} subject={subject_doctype}"
	)
	_write_security_event(
		actor,
		ev.SEPARATION_VIOLATION_BLOCKED,
		reason=f"rule={rule.rule_id}",
		subject_doctype=subject_doctype,
		subject_name=subject_name,
	)


def _write_security_event(
	actor: Actor,
	event: str,
	*,
	reason: str,
	subject_doctype: str | None = None,
	subject_name: str | None = None,
) -> None:
	"""Security events are written outside the request transaction: a blocked
	attempt must survive the rollback that the 403 triggers."""
	try:
		doc = frappe.get_doc(
			{
				"doctype": audit_repo.AUDIT_DOCTYPE,
				"event": event,
				"actor_user": actor.user,
				"actor_eid": actor.eid,
				"actor_persona": ",".join(actor.persona_keys),
				"subject_doctype": subject_doctype or "",
				"subject_name": subject_name or "",
				"reason": reason,
			}
		)
		doc.flags.ignore_permissions = True
		doc.insert()
		frappe.db.commit()
	except Exception:
		# Never let audit failure mask the authorization failure being reported.
		frappe.log_error(title="gdb_bank: security audit write failed")
