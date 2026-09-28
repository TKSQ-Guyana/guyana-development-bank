"""Shared foundation for the GDB portal: pure constants, portal formatters and
the session/role/logging infrastructure that both api.py controllers and the
services/ layer build on.

Dependency rule: this package imports nothing from gdb_bank.api or
gdb_bank.services. The arrows point one way — api -> services -> utils — so no
import cycle can form here.
"""
