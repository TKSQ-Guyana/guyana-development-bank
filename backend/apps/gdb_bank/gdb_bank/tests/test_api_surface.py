"""The endpoint paths the SPA calls must actually resolve.

WHY THIS EXISTS
    `gdb_bank/api.py` and `gdb_bank/api/` briefly coexisted. Python resolves
    the package directory in preference to the module, so every
    `gdb_bank.api.<name>` endpoint in that file silently became unreachable
    while the file sat on disk looking entirely correct. Nothing caught it:
    the syntax was fine, the imports of `gdb_bank.api.v1_identity` still
    worked, and the failure only shows up as a 404 at runtime.

    A dotted path in the frontend is not type-checked by anything. This test is
    the only thing standing between a refactor and a dead endpoint.

    Frappe itself is stubbed: resolving a dotted path needs the import system,
    not a database.

WHEN AN ENDPOINT MOVES
    Update `EXPECTED` and the SPA together, in the same change.
"""

from __future__ import annotations

import importlib
import sys
import types
import unittest


def _install_frappe_stub() -> None:
	"""Minimal `frappe` so the api modules import. Idempotent."""
	if "frappe" in sys.modules and getattr(sys.modules["frappe"], "_gdb_stub", False):
		return

	class _Any:
		def __init__(self, *a, **k):
			pass

		def __getattr__(self, name):
			return _Any()

		def __call__(self, *a, **k):
			return _Any()

	frappe = types.ModuleType("frappe")
	frappe._gdb_stub = True
	frappe.whitelist = lambda *a, **k: (lambda fn: fn)
	frappe._ = lambda s: s
	for name in (
		"throw", "get_doc", "new_doc", "get_all", "get_roles", "db", "cache",
		"local", "session", "utils", "log_error", "logger", "as_json",
		"clear_cache", "permissions", "get_installed_apps",
	):
		setattr(frappe, name, _Any())

	class _Err(Exception):
		pass

	frappe.ValidationError = _Err
	frappe.AuthenticationError = _Err
	frappe.PermissionError = _Err
	sys.modules["frappe"] = frappe

	def _sub(name, **attrs):
		mod = types.ModuleType(name)
		for k, v in attrs.items():
			setattr(mod, k, v)
		sys.modules[name] = mod

	_sub("frappe.utils", cint=int, flt=float, sbool=bool, nowdate=_Any(),
	     now_datetime=_Any(), get_fullname=_Any(), validate_email_address=_Any())
	_sub("frappe.permissions", add_permission=_Any(), remove_permission=_Any(),
	     setup_custom_perms=_Any(), update_permission_property=_Any())
	_sub("frappe.model")
	_sub("frappe.model.document", Document=object)
	_sub("frappe.utils.password", update_password=_Any())
	_sub("frappe.custom")
	_sub("frappe.custom.doctype")
	_sub("frappe.custom.doctype.custom_field")
	_sub("frappe.custom.doctype.custom_field.custom_field", create_custom_fields=_Any())


# Every dotted path the frontend calls. Grep the SPA for `call<` / `call(` to
# confirm this list is complete when you change it.
EXPECTED: tuple[str, ...] = (
	# pre-registry portal surface, re-exported from api/__init__.py
	"gdb_bank.api.signup",
	"gdb_bank.api.apply_loan",
	"gdb_bank.api.my_loans",
	"gdb_bank.api.loan_detail",
	"gdb_bank.api.all_loans",
	"gdb_bank.api.review_loan",
	"gdb_bank.api.whoami",
	# identity
	"gdb_bank.api.v1_identity.exchange_token",
	"gdb_bank.api.v1_identity.whoami",
	"gdb_bank.api.v1_identity.registry",
	# administration
	"gdb_bank.api.v1_admin.users",
	"gdb_bank.api.v1_admin.grant",
	"gdb_bank.api.v1_admin.revoke",
	"gdb_bank.api.v1_admin.set_enabled",
	"gdb_bank.api.v1_admin.preview",
	"gdb_bank.api.v1_admin.rbac_status",
)


def _resolve(dotted: str):
	"""What Frappe does for a whitelisted method: import the module, take the
	attribute."""
	module_path, _, attribute = dotted.rpartition(".")
	module = importlib.import_module(module_path)
	return getattr(module, attribute, None)


class TestEndpointPathsResolve(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		_install_frappe_stub()

	def test_every_expected_endpoint_resolves(self):
		missing = []
		for dotted in EXPECTED:
			try:
				if not callable(_resolve(dotted)):
					missing.append(dotted)
			except ModuleNotFoundError as exc:
				missing.append(f"{dotted} ({exc})")
		self.assertEqual(
			missing,
			[],
			"endpoint path(s) the SPA calls do not resolve: "
			f"{missing}. A dotted path is not type-checked anywhere — if you "
			"moved a module, update the SPA in the same change.",
		)

	def test_no_module_is_shadowed_by_a_package(self):
		"""`foo.py` next to `foo/` means `foo.py` is dead. Catch it structurally
		rather than waiting for a 404."""
		import pathlib

		root = pathlib.Path(__file__).resolve().parent.parent
		clashes = []
		for directory in root.rglob("*"):
			if not directory.is_dir() or directory.name == "__pycache__":
				continue
			if (directory.parent / f"{directory.name}.py").exists():
				clashes.append(str(directory.relative_to(root)))
		self.assertEqual(
			clashes,
			[],
			f"package(s) shadowing a same-named module: {clashes}. "
			"Python resolves the directory; the .py file is silently ignored.",
		)


if __name__ == "__main__":
	unittest.main(verbosity=2)
