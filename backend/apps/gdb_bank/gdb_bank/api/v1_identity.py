"""Identity endpoints (Phase 1).

    POST /api/method/gdb_bank.api.v1_identity.exchange_token
    POST /api/method/gdb_bank.api.v1_identity.whoami
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

from gdb_bank.rbac import capabilities as cap
from gdb_bank.rbac import personas as reg
from gdb_bank.security import errors, keycloak
from gdb_bank.security.session import Actor, current_actor


@frappe.whitelist(allow_guest=True)
def exchange_token(access_token: str):
	"""Trade a verified Keycloak access token for a Frappe session.

	`allow_guest` is correct and load-bearing: the caller is by definition not
	yet authenticated to Frappe. The token itself is the credential, and it is
	verified - signature, issuer, audience and expiry - before anything else
	happens.
	"""
	if not access_token or not isinstance(access_token, str):
		errors.throw(errors.AuthenticationRequired, "Sign-in token is missing.")

	claims = keycloak.verify_token(access_token)
	user = keycloak.provision_user(claims)

	if not frappe.db.get_value("User", user, "enabled"):
		errors.throw(errors.NotAuthorized, "This account has been disabled.")

	# Establish the session the rest of Frappe understands.
	frappe.local.login_manager.login_as(user)
	frappe.local.login_manager.post_login()
	frappe.db.commit()

	frappe.logger("gdb_bank", allow_site=True).info(
		f"session established via Keycloak for personas="
		f"{','.join(p.key for p in reg.personas_for_roles(frappe.get_roles(user))) or 'none'}"
	)
	return _identity_payload(current_actor())


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
		# Kept so the pre-registry SPA build keeps working during the cutover.
		"roles": sorted(actor.roles),
		"is_underwriter": actor.can(cap.CREDIT_APPROVE),
	}


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
