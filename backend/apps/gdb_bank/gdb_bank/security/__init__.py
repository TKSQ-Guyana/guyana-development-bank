"""Authorization policy that is not a single endpoint's gate.

utils/session.py answers "may this caller use this endpoint" (the _require_*
gates). This package answers the questions that must hold whichever door a
change comes through — which account an administrator may touch, which
sign-in door each kind of account may use, and whether two accounts are one
person. Each module is enforced from a Frappe hook as well as from the
service that normally makes the change, so the desk, /api/resource and
frappe.client cannot route around it.
"""
