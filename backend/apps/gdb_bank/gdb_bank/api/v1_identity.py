"""Identity endpoints (Phase 1).

    POST /api/method/gdb_bank.api.v1_identity.sign_in_config
    POST /api/method/gdb_bank.api.v1_identity.exchange_token
    POST /api/method/gdb_bank.api.v1_identity.whoami
    POST /api/method/gdb_bank.api.v1_identity.sign_out
    POST /api/method/gdb_bank.api.v1_identity.registry

The SPA runs the OIDC Authorization Code + PKCE dance against Keycloak itself
and never handles a password. It then posts the resulting access token here
once; this endpoint verifies it against Keycloak's JWKS, provisions the Frappe
user, syncs their roles from the realm-role claims, and establishes the normal
Frappe session cookie. From then on the SPA is cookie-authenticated like any
other Frappe client.

WHY NOT KEEP USING THE BEARER TOKEN
    Frappe's whole permission stack - DocPerms, User Permissions, the
    permission_query_conditions hooks - is built around `frappe.session.user`.
    Converting the token to a session once, at the door, means every later
    request is protected by that stack rather than by bespoke middleware.
"""

from __future__ import annotations

import frappe

from gdb_bank.domain import events as ev
from gdb_bank.rbac import capabilities as cap
from gdb_bank.rbac import personas as reg
from gdb_bank.security import errors, keycloak
from gdb_bank.security.session import Actor, current_actor
from gdb_bank.services import audit


@frappe.whitelist(allow_guest=True)
def sign_in_config():
	"""Where the SPA should send the citizen to authenticate.

	Guest by necessity - it is read by the login page, before anyone is signed
	in. It carries no user data: it is the shape of the identity service, not
	anyone's place in it, and every value in it is already public by the time
	the browser reaches Keycloak's authorize endpoint.
	"""
	return keycloak.public_config()


@frappe.whitelist(allow_guest=True)
def exchange_token(access_token: str, id_token: str | None = None):
	"""Trade a verified Keycloak access token for a Frappe session.

	`allow_guest` is correct and load-bearing: the caller is by definition not
	yet authenticated to Frappe. The token itself is the credential, and it is
	verified - signature, issuer, audience and expiry - before anything else
	happens.

	`id_token` is optional and is NOT a second credential: nothing is decided
	from it. It is kept only so `sign_out` can hand it back to Keycloak as
	`id_token_hint` (see `keycloak.remember_id_token`). It is verified anyway -
	it is the same client, the same realm and the same JWKS, so there is no
	reason to store a blob we have not checked, and an unverified one would be
	an attacker-chosen string echoed into a redirect URL.
	"""
	if not access_token or not isinstance(access_token, str):
		errors.throw(errors.AuthenticationRequired, "Sign-in token is missing.")

	claims = keycloak.verify_token(access_token)
	user = keycloak.provision_user(claims)

	if not frappe.db.get_value("User", user, "enabled"):
		errors.throw(errors.NotAuthorized, "This account has been disabled.")

	# Establish the session the rest of Frappe understands.
	#
	# `login_as` ALREADY CALLS `post_login` (frappe/auth.py: it sets self.user
	# and delegates). Calling both ran the whole login a second time - the
	# `on_login` and `on_session_creation` triggers fired twice, which meant our
	# own Keycloak kill-switch check ran twice per sign-in, and `make_session`
	# built a second session the first one's cookie no longer pointed at.
	frappe.local.login_manager.login_as(user)

	# After `login_as`, not before: `frappe.session.sid` is the new session's,
	# and that is the key `sign_out` will come looking under.
	if id_token and isinstance(id_token, str):
		try:
			keycloak.verify_token(id_token)
		except Exception:
			# A bad id_token must not fail a sign-in that the ACCESS token
			# already authorised. The cost is one confirmation page at logout.
			frappe.logger("gdb_bank", allow_site=True).warning(
				"ignored an id_token that did not verify; logout will need confirmation"
			)
		else:
			keycloak.remember_id_token(frappe.session.sid, id_token)

	actor = current_actor()
	audit.record(
		actor,
		ev.SESSION_ESTABLISHED,
		subject_doctype="User",
		subject_name=user,
		reason="signed in through Keycloak (Authorization Code + PKCE)",
	)
	frappe.db.commit()

	frappe.logger("gdb_bank", allow_site=True).info(
		f"session established via Keycloak for personas={','.join(actor.persona_keys) or 'none'}"
	)
	return _identity_payload(actor)


@frappe.whitelist()
def whoami():
	"""Who the caller is and what they may do.

	The SPA renders its navigation, routes and action buttons from
	`capabilities` - never from a role name. That is what keeps adding a
	persona a backend-only change: the frontend already knows how to render any
	capability set it is handed.

	This is a convenience for the UI, not a security boundary. Every capability
	is re-checked server-side on the call that uses it.
	"""
	return _identity_payload(current_actor())


@frappe.whitelist()
def sign_out():
	"""End the Frappe session, and say where to send the browser to end
	Keycloak's.

	WHY THE SECOND HALF MATTERS. Frappe's own `logout` drops the `sid` and
	nothing else. The Keycloak session cookie survives, so the citizen taps
	"Log out", taps "Sign in with e-ID", and is returned to the portal
	immediately without ever being asked for a credential. It looks exactly
	like the logout silently failed - and on a shared or public machine, the
	consequence is not cosmetic.

	The redirect is returned rather than performed: this is an XHR, and only
	the SPA can navigate the top-level window. A caller that ignores the URL
	still gets a properly ended Frappe session.
	"""
	actor = current_actor()
	audit.record(
		actor,
		ev.SESSION_ENDED,
		subject_doctype="User",
		subject_name=actor.user,
		reason="signed out of the portal",
	)
	frappe.db.commit()

	config = keycloak.public_config()

	# Read the hint BEFORE `logout()`, which discards the session `sid` the
	# stash is keyed on.
	id_token_hint = keycloak.forget_id_token(frappe.session.sid)

	frappe.local.login_manager.logout(user=actor.user)
	frappe.db.commit()

	return {
		"end_session_url": config["end_session_url"] if config["configured"] else None,
		"client_id": config["client_id"],
		# Without this Keycloak cannot tell which session the logout means and
		# renders a "Do you want to log out?" page. A citizen who abandons that
		# page stays signed in to Keycloak - the failure this endpoint's
		# docstring is about. None is survivable, not correct: the citizen gets
		# the confirmation page and must click through it.
		"id_token_hint": id_token_hint,
	}


def _identity_payload(actor: Actor) -> dict:
	return {
		"user": actor.user,
		"full_name": actor.full_name,
		"eid": actor.eid,
		"personas": [
			{
				"key": p.key,
				"title": p.title,
				"portal_home": p.portal_home,
				"row_scope": p.row_scope.value,
			}
			for p in actor.personas
		],
		"capabilities": sorted(actor.capabilities),
		"row_scope": actor.row_scope.value,
		"portal_home": actor.portal_home(),
	}
	# `roles` and `is_underwriter` were removed on 2026-09-21. They were the
	# pre-registry cutover shims, and `roles` never had a reader in the SPA at
	# all. Shipping them was the thing that kept role-name branching available:
	# a field that is present gets used, and `user.is_underwriter` is exactly
	# the coupling CLAUDE.md forbids ("authorize on capabilities, not role
	# names"). The SPA branches on `capabilities` only.
	#
	# This is a BREAKING change to the whoami contract. Nothing in this repo
	# reads either field; an external consumer would need `capabilities`.


@frappe.whitelist()
def registry():
	"""The capability vocabulary and persona catalogue, for the admin screen.

	Contains no user data - it is the shape of the role model, not anyone's
	place in it - so any authenticated user may read it. The SPA uses it to
	label capabilities in the role-management UI.
	"""
	current_actor()
	return {
		"capabilities": sorted(cap.ALL_CAPABILITIES),
		"personas": [
			{
				"key": p.key,
				"title": p.title,
				"description": p.description,
				"row_scope": p.row_scope.value,
				"capabilities": sorted(p.capabilities),
				"portal_home": p.portal_home,
				"retired": p.retired,
			}
			for p in reg.PERSONAS
		],
	}
