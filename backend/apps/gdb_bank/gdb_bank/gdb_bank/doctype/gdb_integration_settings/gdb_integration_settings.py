"""The portal-editable overrides for every integration setting.

Read through gdb_bank.integrations.settings, which falls back to site_config
and then the environment for anything left empty here. Written only by
services/integration_settings.py, which requires a reason and records the
change; no role holds write in the desk, so that is the one way in.

The shape rules live on the doctype, so a value that could not work is refused
however it arrives.
"""

from frappe.model.document import Document

from gdb_bank.integrations import settings


class GDBIntegrationSettings(Document):
	def validate(self):
		for key in settings.KEYS:
			if not settings.is_secret(key):
				self.set(key, settings.normalize(key, self.get(key)) or None)
