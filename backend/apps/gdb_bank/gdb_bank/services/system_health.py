"""Is the platform healthy? — the platform administrator's one-screen answer.

Everything here is read-only, reads Frappe's own records (Error Log,
Scheduled Job Log, the RQ queues, the site's backup folder) and returns
counts, times and titles only. No traceback, no request payload and no file
path leaves the server: an Error Log body can carry an applicant's data, and
a path is an internal detail. The full record stays in the desk for the
System Manager.

Each section degrades on its own. A Redis that cannot be reached makes the
queue section say so; it does not take the whole screen down with it.
"""

import os
from datetime import datetime

import frappe
from frappe.utils import add_to_date, now_datetime

from gdb_bank.services import integration_settings
from gdb_bank.utils.session import _logger

WINDOW_HOURS = 24
RECENT_ROWS = 10

# `bench backup` file suffixes -> what they hold.
_BACKUP_KINDS = {"-database.sql.gz": "database", "-private-files.tar": "private_files"}


def _since():
	return add_to_date(now_datetime(), hours=-WINDOW_HOURS)


def _scheduler() -> dict:
	from frappe.utils.scheduler import is_scheduler_disabled, is_scheduler_inactive

	conf = frappe.local.conf
	if conf.get("maintenance_mode"):
		state = "maintenance"
	elif conf.get("pause_scheduler"):
		state = "paused"
	elif is_scheduler_disabled(verbose=False):
		state = "disabled"
	elif is_scheduler_inactive(verbose=False):
		state = "inactive"
	else:
		state = "running"
	last = frappe.get_all("Scheduled Job Log", fields=["creation"], order_by="creation desc", limit_page_length=1)
	failed = frappe.get_all(
		"Scheduled Job Log",
		filters={"status": "Failed", "creation": [">=", _since()]},
		fields=["scheduled_job_type", "creation"],
		order_by="creation desc",
		limit_page_length=RECENT_ROWS,
	)
	return {
		"state": state,
		"last_run": last[0].creation if last else None,
		"failed_jobs": [{"job": r.scheduled_job_type, "at": r.creation} for r in failed],
		"failed_count": frappe.db.count("Scheduled Job Log", {"status": "Failed", "creation": [">=", _since()]}),
	}


def _queues() -> dict:
	from frappe.utils.background_jobs import get_queue, get_queue_list, get_workers

	try:
		queues = []
		for name in get_queue_list():
			queue = get_queue(name)
			queues.append({"name": name, "queued": queue.count, "failed": queue.failed_job_registry.count})
		return {"available": True, "queues": queues, "workers": len(get_workers())}
	except Exception as exc:  # redis down or misconfigured — report, don't fail the page
		_logger().error(f"health: queue status unavailable: {exc}")
		return {"available": False, "queues": [], "workers": 0}


def _errors() -> dict:
	rows = frappe.get_all(
		"Error Log",
		filters={"creation": [">=", _since()]},
		fields=["method", "creation"],
		order_by="creation desc",
		limit_page_length=RECENT_ROWS,
	)
	return {
		"count": frappe.db.count("Error Log", {"creation": [">=", _since()]}),
		# `method` is the Error Log's title. Truncated, and the body (`error`,
		# the traceback) is deliberately not read.
		"recent": [{"title": (r.method or "")[:140], "at": r.creation} for r in rows],
	}


def _backups() -> dict:
	"""The newest backup set in the site's own backup folder.

	Checked for the private-files archive specifically: applicant evidence lives
	in private/files, not the database, so a database-only backup restores a
	bank with no documents.
	"""
	folder = os.path.abspath(frappe.get_site_path("private", "backups"))
	newest: dict[str, float] = {}
	try:
		with os.scandir(folder) as entries:
			for entry in entries:
				kind = next((k for suffix, k in _BACKUP_KINDS.items() if entry.name.endswith(suffix)), None)
				if kind:
					newest[kind] = max(newest.get(kind, 0), entry.stat().st_mtime)
	except FileNotFoundError:
		pass

	database = datetime.fromtimestamp(newest["database"]) if "database" in newest else None
	private_files = datetime.fromtimestamp(newest["private_files"]) if "private_files" in newest else None
	return {
		"last_database": database,
		"last_private_files": private_files,
		# A files archive older than the database dump by more than a day means
		# the newest restore point would come back without recent evidence.
		"includes_private_files": bool(
			database and private_files and abs((database - private_files).total_seconds()) < 86400
		),
	}


def report() -> dict:
	return {
		"checked_on": now_datetime(),
		"window_hours": WINDOW_HOURS,
		"scheduler": _scheduler(),
		"queues": _queues(),
		"errors": _errors(),
		"backups": _backups(),
		"integrations": integration_settings.status(),
	}
