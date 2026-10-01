"""OpenAPI spec for every gdb_bank whitelisted method, generated from the code.

Read off Frappe's own whitelist registry, so a new endpoint appears on the next
restart and nothing here can drift. Swagger UI lives at
/assets/gdb_bank/api-docs.html and loads this spec; it is same-origin, so
"Try it out" carries the caller's `sid` cookie.

Only a System Manager may read the spec: a map of every money endpoint is
reconnaissance for anyone else.
"""

import importlib
import inspect
import pkgutil
import typing

import frappe

import gdb_bank

JSON_TYPES = {str: "string", int: "integer", float: "number", bool: "boolean", dict: "object", list: "array"}

# Frappe's own endpoints a tester needs: the Administrator break-glass login,
# logout, and the upload step of the evidence flow (documents.py).
FRAPPE_PATHS = {
	"/api/method/login": {"post": {
		"tags": ["frappe"], "summary": "System User sign-in (Administrator). Citizens and staff use gdb_bank.identity.",
		"requestBody": {"content": {"application/json": {"schema": {"type": "object", "required": ["usr", "pwd"],
			"properties": {"usr": {"type": "string"}, "pwd": {"type": "string", "format": "password"}}}}}},
		"responses": {"200": {"description": "Signed in; sets the sid cookie"}},
	}},
	"/api/method/logout": {"post": {"tags": ["frappe"], "summary": "End the current session", "responses": {"200": {"description": "OK"}}}},
	"/api/method/upload_file": {"post": {
		"tags": ["frappe"], "summary": "Upload evidence against a shelf row made by gdb_bank.documents.new_document",
		"requestBody": {"content": {"multipart/form-data": {"schema": {"type": "object", "required": ["file", "doctype", "docname"],
			"properties": {"file": {"type": "string", "format": "binary"}, "doctype": {"type": "string", "default": "GDB Applicant Document"},
				"docname": {"type": "string"}, "is_private": {"type": "integer", "default": 1}}}}}},
		"responses": {"200": {"description": "The File record"}},
	}},
}


@frappe.whitelist(methods=["GET"])
def openapi() -> dict:
	frappe.only_for("System Manager")
	# The registry only holds functions whose module has been imported.
	for mod in pkgutil.iter_modules(gdb_bank.__path__):
		if not mod.ispkg:
			importlib.import_module(f"gdb_bank.{mod.name}")

	paths = dict(FRAPPE_PATHS)
	for fn in frappe.whitelisted:
		if not fn.__module__.startswith("gdb_bank.") or "." in fn.__qualname__:
			continue  # other apps, and doctype controller methods
		methods = frappe.allowed_http_methods_for_whitelisted_func.get(fn, ())
		verb = "post" if "POST" in methods else "get"
		path = f"/api/method/{fn.__module__}.{fn.__name__}"
		paths[path] = {verb: _operation(fn, verb)}

	return {
		"openapi": "3.0.3",
		"info": {"title": "GDB loan portal API", "version": gdb_bank.__version__},
		"paths": dict(sorted(paths.items())),
	}


def _operation(fn, verb: str) -> dict:
	doc = inspect.getdoc(fn) or ""
	guest = fn in frappe.guest_methods
	params = {}
	required = []
	for p in inspect.signature(fn).parameters.values():
		if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
			continue
		params[p.name] = _schema(p.annotation)
		if p.default is p.empty:
			required.append(p.name)

	op = {
		"tags": [fn.__module__.removeprefix("gdb_bank.")],
		"summary": doc.split("\n", 1)[0][:120] or fn.__name__,
		"description": ("**Guest** — no sign-in needed.\n\n" if guest else "") + doc,
		"responses": {"200": {"description": "`{\"message\": ...}`"}},
	}
	if verb == "post":
		body = {"type": "object", "properties": params}
		if required:
			body["required"] = required
		op["requestBody"] = {"required": bool(required), "content": {"application/json": {"schema": body}}}
	else:
		op["parameters"] = [
			{"name": n, "in": "query", "required": n in required, "schema": s} for n, s in params.items()
		]
	return op


def _schema(ann) -> dict:
	# `str | None` -> string; untyped -> string (Frappe hands it over as sent).
	args = [a for a in (typing.get_args(ann) or (ann,)) if a is not type(None)]
	t = (typing.get_origin(args[0]) or args[0]) if args else str
	kind = JSON_TYPES.get(t, "string")
	return {"type": "array", "items": {}} if kind == "array" else {"type": kind}
