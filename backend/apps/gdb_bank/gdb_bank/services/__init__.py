"""Citizen-portal business logic, lifted out of the api.py monolith.

Each module here holds the banking rules for one slice of the portal — user
provisioning, loan applications, borrower repayments — with no HTTP context of
its own. The whitelisted endpoints in gdb_bank.api are thin controllers that
extract the session user, enforce the role gate, and delegate here.

Dependency rule: services import from utils (and each other) but NEVER from
gdb_bank.api at module load. A few helpers that deliberately stay in api.py
(the cluster capability) are reached through function-local imports — the same
escape hatch identity.py and permissions.py already use.
"""
