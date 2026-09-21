"""Project the persona registry onto its non-Python consumers.

`rbac/personas.py` is the single source of truth, but three systems need to
agree with it, in three different languages:

    1. Frappe    - Roles, Role Profiles, Custom DocPerms.
                   Handled at runtime by `rbac/provisioning.reconcile()`.
    2. The SPA   - capability strings that drive navigation and routes.
                   Generated here into capabilities.generated.ts.
    3. Keycloak  - the realm roles whose claims map onto personas.
                   Generated here into gdb-realm-structure.generated.mjs.

Hand-maintaining (2) and (3) is how they drift. A typo in the TypeScript fails
silently - the button just never renders. A realm role missing from Keycloak
fails worse: the persona exists in Frappe but nobody can ever be granted it,
and the failure looks like "the new role doesn't work" three environments
later. So both are generated, never hand-written.

    cd backend && python scripts/export_rbac.py           # write
    cd backend && python scripts/export_rbac.py --check    # CI: fail if stale

This imports the registry only - no Frappe, no database, no site needed.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
APP_ROOT = HERE.parent / "apps" / "gdb_bank"
REPO = HERE.parent.parent

TS_TARGET = REPO / "frontend" / "src" / "shared" / "rbac" / "capabilities.generated.ts"
KC_TARGET = HERE / "gdb-realm-structure.generated.mjs"

sys.path.insert(0, str(APP_ROOT))

from gdb_bank.rbac import capabilities as cap  # noqa: E402
from gdb_bank.rbac import personas as reg  # noqa: E402

HEADER = """// GENERATED FILE - DO NOT EDIT.
// Source of truth: backend/apps/gdb_bank/gdb_bank/rbac/capabilities.py
//                  backend/apps/gdb_bank/gdb_bank/rbac/personas.py
// Regenerate:      cd backend && python scripts/export_rbac.py
//
// The SPA authorizes nothing - these strings drive what it RENDERS. Every
// capability is re-checked server-side by rbac/guards.py on the call that
// uses it, so a tampered client gets a 403, not data.
"""


def const_name(capability: str) -> str:
	return capability.replace(".", "_").upper()


def render() -> str:
	lines = [HEADER, "export const CAP = {"]
	for capability in sorted(cap.ALL_CAPABILITIES):
		lines.append(f"  {const_name(capability)}: '{capability}',")
	lines.append("} as const;\n")

	lines.append("export type Capability = (typeof CAP)[keyof typeof CAP];\n")

	lines.append("/** Persona catalogue, mirrored for labels and admin screens. */")
	lines.append("export const PERSONAS = [")
	for persona in reg.ACTIVE_PERSONAS:
		caps = ", ".join(f"'{c}'" for c in sorted(persona.capabilities))
		lines.append("  {")
		lines.append(f"    key: '{persona.key}',")
		lines.append(f"    title: {_ts_string(persona.title)},")
		lines.append(f"    description: {_ts_string(persona.description)},")
		lines.append(f"    rowScope: '{persona.row_scope.value}',")
		lines.append(f"    portalHome: '{persona.portal_home}',")
		lines.append(f"    capabilities: [{caps}] as Capability[],")
		lines.append("  },")
	lines.append("] as const;\n")

	lines.append("export type PersonaKey = (typeof PERSONAS)[number]['key'];")
	return "\n".join(lines) + "\n"


def _ts_string(value: str) -> str:
	return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


KC_HEADER = """// GENERATED FILE - DO NOT EDIT.
// Source of truth: backend/apps/gdb_bank/gdb_bank/rbac/personas.py
// Regenerate:      cd backend && python scripts/export_rbac.py
//
// The realm roles a GDB persona is granted by. Consumed by
// keycloak-local/setup-gdb.mjs (the dev seeder) and by the deploy-time realm
// gate, exactly as kc-realm-structure.mjs is for MPS.
//
// A persona whose realm role is missing from Keycloak exists in Frappe but can
// never be granted to anyone by login - which is why this is generated rather
// than kept in step by hand.
"""


def render_keycloak() -> str:
	lines = [KC_HEADER, "export const GDB_REALM_ROLES = ["]
	for persona in reg.ACTIVE_PERSONAS:
		for realm_role in persona.keycloak_roles:
			# Realm roles shared with the MPS realm export (e.g. "Citizen") are
			# already present; emitting them again is harmless and idempotent.
			description = f"GDB {persona.title} - {persona.description}"
			lines.append("  {")
			lines.append(f"    name: {_js_string(realm_role)},")
			lines.append(f"    description: {_js_string(description)},")
			lines.append(f"    persona: {_js_string(persona.key)},")
			lines.append(f"    frappeRole: {_js_string(persona.role)},")
			lines.append("  },")
	lines.append("];\n")

	lines.append("/** The public OIDC client the GDB portal signs in through. */")
	lines.append("export const GDB_PORTAL_CLIENT = {")
	lines.append("  clientId: 'gdb-portal',")
	lines.append("  publicClient: true,")
	lines.append("  standardFlowEnabled: true,")
	lines.append("  // PKCE, no client secret in the browser (CLAUDE.md section 4).")
	lines.append("  attributes: { 'pkce.code.challenge.method': 'S256' },")
	lines.append("  redirectUris: [")
	lines.append("    'http://localhost:3000/*',")
	lines.append("    'http://localhost:3001/*',")
	lines.append("    'http://localhost:5173/*',")
	lines.append("  ],")
	lines.append("  webOrigins: [")
	lines.append("    'http://localhost:3000',")
	lines.append("    'http://localhost:3001',")
	lines.append("    'http://localhost:5173',")
	lines.append("  ],")
	lines.append("};\n")

	lines.append("/** The token claim carrying the three-box e-ID. */")
	lines.append("export const GDB_EID_CLAIM = 'eid';")
	return "\n".join(lines) + "\n"


def _js_string(value: str) -> str:
	return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


OUTPUTS = (
	("capabilities.generated.ts", lambda: TS_TARGET, render),
	("gdb-realm-structure.generated.mjs", lambda: KC_TARGET, render_keycloak),
)


def main() -> int:
	parser = argparse.ArgumentParser()
	parser.add_argument(
		"--check",
		action="store_true",
		help="exit non-zero if a committed file differs (for CI)",
	)
	args = parser.parse_args()

	stale = []
	for label, target_fn, render_fn in OUTPUTS:
		target = target_fn()
		content = render_fn()

		if args.check:
			current = target.read_text(encoding="utf-8") if target.exists() else ""
			if current != content:
				stale.append(label)
			continue

		target.parent.mkdir(parents=True, exist_ok=True)
		target.write_text(content, encoding="utf-8")
		print(f"wrote {target}")

	if args.check:
		if stale:
			print(
				f"stale generated file(s): {', '.join(stale)}\n"
				"Run: cd backend && python scripts/export_rbac.py",
				file=sys.stderr,
			)
			return 1
		print("generated files are up to date")
		return 0

	print(
		f"{len(cap.ALL_CAPABILITIES)} capabilities, {len(reg.ACTIVE_PERSONAS)} personas, "
		f"{sum(len(p.keycloak_roles) for p in reg.ACTIVE_PERSONAS)} realm roles"
	)
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
