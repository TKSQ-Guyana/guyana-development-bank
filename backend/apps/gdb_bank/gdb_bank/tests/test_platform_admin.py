"""Platform Admin: runs the platform, and can do none of the Bank's work.

Every test acts through the portal's own endpoints as the person acting. The
endpoints commit, so commit is suppressed and each test is rolled back. The
Keycloak admin API is patched out: these tests are about what GDB decides,
not about Keycloak's HTTP.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_platform_admin
"""

import inspect
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import api, identity, platform_admin
from gdb_bank.integrations import settings as integration_settings
from gdb_bank.security import sign_in_policy
from gdb_bank.security.conflict import is_same_person
from gdb_bank.services import access_audit

ADMIN = "test-gdb-admin@example.gy"
OTHER_ADMIN = "test-gdb-admin2@example.gy"
UNDERWRITER = "test-gdb-uw@example.gy"
DISBURSER = "test-gdb-do@example.gy"
CITIZEN = "test-gdb-citizen@example.gy"
NEW_STAFF = "test-gdb-newhire@gdb.gov.gy"

CITIZEN_EID = "592-9100-0001"
REASON = "Test: new hire, credit team"

STAFF_REALM = {"population": identity.STAFF, "realm": "gdb-staff"}
ONE_TIME = "Abcd-Efgh-2345"
CHOSEN = "my own long passphrase 42"

# The sign-in endpoints are called beneath their whitelist and rate-limit
# wrappers: the rate limiter reads the live request, and these tests are about
# what the door decides, not how often it may be knocked on.
staff_login = inspect.unwrap(identity.staff_login)
staff_set_password = inspect.unwrap(identity.staff_set_password)


def _user(email: str, *roles: str, user_type: str = "System User", eid: str | None = None) -> None:
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": email.split("@")[0].removeprefix("test-gdb-").title(),
			"user_type": user_type,
			"send_welcome_email": 0,
			"roles": [{"role": role} for role in roles],
		}
	).insert(ignore_permissions=True)
	if eid:
		frappe.db.set_value("User", email, "gdb_eid", eid)


def _trail(subject_user: str) -> list:
	return frappe.get_all(
		access_audit.DOCTYPE,
		filters={"subject_user": subject_user},
		fields=["action", "old_value", "new_value", "reason", "actor"],
		order_by="creation asc",
	)


class TestPlatformAdmin(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		# No Keycloak in a test run: account management is "not configured",
		# which is itself a state the portal must handle.
		self.enterContext(patch("gdb_bank.integrations.keycloak_admin.is_configured", return_value=False))

		_user(ADMIN, "Platform Admin")
		_user(OTHER_ADMIN, "Platform Admin")
		_user(UNDERWRITER, "Loan Underwriter")
		_user(DISBURSER, "Disbursement Officer")
		_user(CITIZEN, "Citizen", user_type="Website User", eid=CITIZEN_EID)

	def create_staff(self, roles=("Loan Underwriter",), eid=None) -> dict:
		with self.set_user(ADMIN):
			return platform_admin.create_staff_user(
				full_name="Kevin Ramdass", email=NEW_STAFF, roles=list(roles), reason=REASON, eid=eid
			)

	# -- the persona cannot do the Bank's work ------------------------------------

	def test_the_admin_is_refused_every_credit_and_money_door(self):
		with self.set_user(ADMIN):
			for call in (
				lambda: api.all_loans(),
				lambda: api.review_loan(name="ACC-LOAP-NONE", action="approve"),
				lambda: api.book_loan(application="ACC-LOAP-NONE"),
				lambda: api.disburse_loan(application="ACC-LOAP-NONE"),
			):
				with self.assertRaises(frappe.PermissionError):
					call()

	def test_nobody_but_the_admin_reaches_the_console(self):
		for user in (UNDERWRITER, DISBURSER, CITIZEN):
			with self.set_user(user), self.assertRaises(frappe.PermissionError):
				platform_admin.list_users()
			with self.set_user(user), self.assertRaises(frappe.PermissionError):
				platform_admin.system_health()

	def test_whoami_says_platform_admin_and_nothing_else(self):
		with self.set_user(ADMIN):
			me = api.whoami()
		self.assertTrue(me["is_platform_admin"])
		self.assertFalse(me["is_underwriter"] or me["is_finance"] or me["is_disbursement"])

	# -- accounts -------------------------------------------------------------------

	def test_creating_a_staff_account_grants_only_what_was_asked_and_is_recorded(self):
		result = self.create_staff(eid="592-9100-0099")

		self.assertEqual(result["user"]["roles"], ["Loan Underwriter"])
		self.assertEqual(result["user"]["eid"], "592-9100-0099")
		self.assertEqual(frappe.db.get_value("User", NEW_STAFF, "user_type"), "System User")
		self.assertEqual(result["keycloak"]["status"], "manual")
		trail = _trail(NEW_STAFF)
		self.assertEqual([(t.action, t.new_value, t.reason, t.actor) for t in trail], [
			(access_audit.ACCOUNT_CREATED, "Loan Underwriter", REASON, ADMIN),
		])

	def test_superuser_and_admin_roles_are_never_grantable(self):
		for role in ("System Manager", "Platform Admin", "Administrator", "Loan Manager"):
			with self.set_user(ADMIN), self.assertRaises(frappe.PermissionError):
				platform_admin.create_staff_user(
					full_name="X", email=f"x-{frappe.generate_hash(length=6)}@gdb.gov.gy", roles=[role], reason=REASON
				)
		self.create_staff()
		with self.set_user(ADMIN), self.assertRaises(frappe.PermissionError):
			platform_admin.set_user_roles(user=NEW_STAFF, roles=["System Manager"], reason=REASON)

	def test_a_change_needs_a_reason(self):
		self.create_staff()
		with self.set_user(ADMIN), self.assertRaises(frappe.ValidationError):
			platform_admin.set_user_enabled(user=NEW_STAFF, enabled=0, reason="  ")

	def test_the_admin_cannot_touch_their_own_account_or_another_admins(self):
		for target in (ADMIN, OTHER_ADMIN, "Administrator"):
			with self.set_user(ADMIN), self.assertRaises(frappe.PermissionError):
				platform_admin.set_user_enabled(user=target, enabled=0, reason=REASON)
		with self.set_user(ADMIN), self.assertRaises(frappe.PermissionError):
			platform_admin.set_user_roles(user=ADMIN, roles=["Disbursement Officer"], reason=REASON)

	def test_setting_the_same_roles_twice_is_one_change(self):
		self.create_staff()
		with self.set_user(ADMIN):
			first = platform_admin.set_user_roles(
				user=NEW_STAFF, roles=["Loan Underwriter", "Disbursement Officer"], reason=REASON
			)
			second = platform_admin.set_user_roles(
				user=NEW_STAFF, roles=["Disbursement Officer", "Loan Underwriter"], reason=REASON
			)
		self.assertTrue(first["changed"])
		self.assertFalse(second["changed"])
		self.assertTrue(first["user"]["warnings"])  # decide AND release
		changes = [t for t in _trail(NEW_STAFF) if t.action == access_audit.ROLES_CHANGED]
		self.assertEqual(len(changes), 1)
		self.assertEqual(changes[0].old_value, "Loan Underwriter")
		self.assertEqual(changes[0].new_value, "Disbursement Officer, Loan Underwriter")

	def test_disabling_is_the_kill_switch_and_ends_open_sessions(self):
		self.create_staff()
		with patch("gdb_bank.services.accounts.clear_sessions") as cleared, self.set_user(ADMIN):
			result = platform_admin.set_user_enabled(user=NEW_STAFF, enabled=0, reason="Resigned")
		self.assertFalse(result["user"]["enabled"])
		cleared.assert_called_once_with(user=NEW_STAFF, force=True)
		self.assertEqual(frappe.db.get_value("User", NEW_STAFF, "enabled"), 0)
		self.assertEqual(_trail(NEW_STAFF)[-1].action, access_audit.ACCOUNT_DISABLED)

	def test_a_citizen_can_be_disabled_but_never_given_a_staff_role(self):
		with self.set_user(ADMIN):
			platform_admin.set_user_enabled(user=CITIZEN, enabled=0, reason="Suspected fraud")
		self.assertEqual(frappe.db.get_value("User", CITIZEN, "enabled"), 0)
		with self.set_user(ADMIN), self.assertRaises(frappe.PermissionError):
			platform_admin.set_user_roles(user=CITIZEN, roles=["Loan Underwriter"], reason=REASON)

	def test_citizen_passwords_are_the_e_id_services_business(self):
		with self.set_user(ADMIN), self.assertRaises(frappe.ValidationError):
			platform_admin.reset_password(user=CITIZEN, reason=REASON)

	# -- one-time passwords ---------------------------------------------------------

	def keycloak(self):
		"""The Keycloak admin API as a double, for an account it does not hold yet."""
		self.enterContext(patch("gdb_bank.integrations.keycloak_admin.is_configured", return_value=True))
		self.enterContext(patch("gdb_bank.integrations.keycloak_admin.ensure_account", return_value=("kc-1", True)))
		return self.enterContext(patch("gdb_bank.integrations.keycloak_admin.set_password"))

	def test_a_new_staff_account_gets_a_one_time_password_shown_once(self):
		set_password = self.keycloak()
		result = self.create_staff()

		password = result["one_time_password"]
		self.assertRegex(password, r"^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$")
		self.assertEqual(result["keycloak"]["status"], "issued")
		set_password.assert_called_once_with("kc-1", password, temporary=True)
		trail = _trail(NEW_STAFF)
		self.assertEqual(
			[t.action for t in trail], [access_audit.ACCOUNT_CREATED, access_audit.ONE_TIME_PASSWORD_ISSUED]
		)
		# Returned once, kept nowhere: not the trail, not the account as read back.
		self.assertNotIn(password, frappe.as_json(trail))
		with self.set_user(ADMIN):
			self.assertNotIn(password, frappe.as_json(platform_admin.get_user(user=NEW_STAFF)))

	def test_a_reset_issues_a_new_one_time_password_and_ends_open_sessions(self):
		set_password = self.keycloak()
		first = self.create_staff()["one_time_password"]
		with patch("gdb_bank.services.accounts.clear_sessions") as cleared, self.set_user(ADMIN):
			result = platform_admin.reset_password(user=NEW_STAFF, reason="Forgot their password")

		self.assertNotEqual(result["one_time_password"], first)
		set_password.assert_called_with("kc-1", result["one_time_password"], temporary=True)
		cleared.assert_called_once_with(user=NEW_STAFF, force=True)
		self.assertEqual(_trail(NEW_STAFF)[-1].action, access_audit.ONE_TIME_PASSWORD_ISSUED)

	def test_a_one_time_password_signs_nobody_in(self):
		self.create_staff()
		with (
			patch("gdb_bank.identity.keycloak_settings", return_value=STAFF_REALM),
			patch("gdb_bank.identity._request_token", side_effect=identity._PasswordChangeRequired),
			patch("gdb_bank.identity._open_staff_session") as opened,
		):
			result = staff_login(email=NEW_STAFF, password=ONE_TIME)
		self.assertEqual(result, {"password_change_required": True})
		opened.assert_not_called()

	def test_choosing_a_password_replaces_the_one_time_one_then_signs_in(self):
		self.create_staff()
		with (
			patch("gdb_bank.identity.keycloak_settings", return_value=STAFF_REALM),
			patch("gdb_bank.integrations.keycloak_admin.is_configured", return_value=True),
			patch(
				"gdb_bank.identity._request_token", side_effect=[identity._PasswordChangeRequired, "token"]
			) as grant,
			patch(
				"gdb_bank.integrations.keycloak_admin.sign_in_account",
				return_value={"id": "kc-1", "required_actions": ["UPDATE_PASSWORD"]},
			),
			patch("gdb_bank.integrations.keycloak_admin.set_password") as set_password,
			patch("gdb_bank.identity._open_staff_session", return_value={"user": NEW_STAFF}) as opened,
		):
			staff_set_password(email=NEW_STAFF, password=ONE_TIME, new_password=CHOSEN)

		set_password.assert_called_once_with("kc-1", CHOSEN, temporary=False)
		self.assertEqual(grant.call_args_list[1].args, (STAFF_REALM, NEW_STAFF, CHOSEN))
		opened.assert_called_once()
		chosen = _trail(NEW_STAFF)[-1]
		self.assertEqual((chosen.action, chosen.actor), (access_audit.PASSWORD_CHOSEN, NEW_STAFF))
		self.assertNotIn(CHOSEN, frappe.as_json(_trail(NEW_STAFF)))

	def test_a_wrong_one_time_password_changes_nothing(self):
		self.create_staff()
		with (
			patch("gdb_bank.identity.keycloak_settings", return_value=STAFF_REALM),
			patch("gdb_bank.integrations.keycloak_admin.is_configured", return_value=True),
			patch("gdb_bank.identity._request_token", return_value=None),
			patch("gdb_bank.integrations.keycloak_admin.set_password") as set_password,
			self.assertRaises(frappe.AuthenticationError),
		):
			staff_set_password(email=NEW_STAFF, password="Wrong-Pass-9999", new_password=CHOSEN)
		set_password.assert_not_called()

	def test_it_is_not_a_general_change_password_door(self):
		# An account waiting on something other than a new password, e.g. a
		# profile step, is not this door's to clear.
		self.create_staff()
		with (
			patch("gdb_bank.identity.keycloak_settings", return_value=STAFF_REALM),
			patch("gdb_bank.integrations.keycloak_admin.is_configured", return_value=True),
			patch("gdb_bank.identity._request_token", side_effect=identity._PasswordChangeRequired),
			patch(
				"gdb_bank.integrations.keycloak_admin.sign_in_account",
				return_value={"id": "kc-1", "required_actions": ["VERIFY_PROFILE"]},
			),
			patch("gdb_bank.integrations.keycloak_admin.set_password") as set_password,
			self.assertRaises(frappe.ValidationError),
		):
			staff_set_password(email=NEW_STAFF, password=ONE_TIME, new_password=CHOSEN)
		set_password.assert_not_called()

	def test_the_chosen_password_must_be_the_persons_own(self):
		for new_password in ("Sh0rt-pass", ONE_TIME, NEW_STAFF):
			with self.assertRaises(frappe.ValidationError):
				staff_set_password(email=NEW_STAFF, password=ONE_TIME, new_password=new_password)

	def test_the_user_hook_closes_every_other_door(self):
		self.create_staff()
		with self.set_user(ADMIN):
			doc = frappe.get_doc("User", NEW_STAFF)
			doc.append("roles", {"role": "System Manager"})
			with self.assertRaises(frappe.PermissionError):
				doc.save(ignore_permissions=True)

			doc = frappe.get_doc("User", NEW_STAFF)
			# Strong enough to pass Frappe's own password policy, so the refusal
			# can only be the platform-admin rule.
			doc.new_password = "Zq8#vT3!mW9$rL2p-Gx7"
			with self.assertRaises(frappe.PermissionError):
				doc.save(ignore_permissions=True)

	def test_the_access_trail_cannot_be_rewritten(self):
		self.create_staff()
		name = frappe.get_all(access_audit.DOCTYPE, filters={"subject_user": NEW_STAFF}, pluck="name")[0]
		doc = frappe.get_doc(access_audit.DOCTYPE, name)
		doc.reason = "rewritten"
		with self.assertRaises(frappe.PermissionError):
			doc.save(ignore_permissions=True)
		with self.assertRaises(frappe.PermissionError):
			frappe.delete_doc(access_audit.DOCTYPE, name, ignore_permissions=True, force=True)

	# -- sign-in doors and the same-person check ------------------------------------

	def test_each_realm_opens_only_its_own_kind_of_account(self):
		self.assertIsNotNone(sign_in_policy.refusal(UNDERWRITER, sign_in_policy.EID))
		self.assertIsNotNone(sign_in_policy.refusal(ADMIN, sign_in_policy.EID))
		self.assertIsNone(sign_in_policy.refusal(CITIZEN, sign_in_policy.EID))

		self.assertIsNotNone(sign_in_policy.refusal(CITIZEN, sign_in_policy.STAFF))
		self.assertIsNone(sign_in_policy.refusal(UNDERWRITER, sign_in_policy.STAFF))
		self.assertIsNone(sign_in_policy.refusal(ADMIN, sign_in_policy.STAFF))

		# Frappe's own password form: never a citizen.
		self.assertIsNotNone(sign_in_policy.refusal(CITIZEN, None))
		self.assertIsNone(sign_in_policy.refusal("Administrator", None))

	def test_an_officer_cannot_decide_their_own_citizen_application(self):
		# The underwriter's national e-ID, recorded on the staff account, is the
		# e-ID their separate citizen account signs in with.
		frappe.db.set_value("User", UNDERWRITER, "gdb_staff_eid", CITIZEN_EID)
		self.assertTrue(is_same_person(UNDERWRITER, CITIZEN))
		self.assertFalse(is_same_person(DISBURSER, CITIZEN))

		with self.set_user(CITIZEN):
			application = api.save_application(
				loan_amount=500000, purpose="Cold store", term_months=12, sections={"moratorium_months": 1}
			)["name"]
			api.submit_application(name=application)
		with self.set_user(UNDERWRITER), self.assertRaises(frappe.PermissionError):
			api.review_loan(name=application, action="approve")

	# -- integration settings -------------------------------------------------------

	def test_a_secret_is_stored_but_never_returned(self):
		with self.set_user(ADMIN):
			platform_admin.save_integration_settings(
				group="staff_accounts",
				values={"keycloak_admin_client_id": "gdb-portal-admin", "keycloak_admin_client_secret": "s3cret-value"},
				reason="Rotate the admin client",
			)
			overview = platform_admin.integration_settings()

		self.assertNotIn("s3cret-value", frappe.as_json(overview))
		group = next(g for g in overview if g["key"] == "staff_accounts")
		secret = next(f for f in group["fields"] if f["key"] == "keycloak_admin_client_secret")
		self.assertEqual((secret["value"], secret["is_set"], secret["source"]), (None, True, "settings"))
		self.assertEqual(integration_settings.get("keycloak_admin_client_secret"), "s3cret-value")

	def test_a_malformed_url_is_refused(self):
		with self.set_user(ADMIN), self.assertRaises(frappe.ValidationError):
			platform_admin.save_integration_settings(
				group="dcra", values={"dcra_base_url": "not a url"}, reason="Point at DCRA"
			)

	def test_health_reports_without_failing(self):
		with self.set_user(ADMIN):
			report = platform_admin.system_health()
		self.assertEqual(
			set(report), {"checked_on", "window_hours", "scheduler", "queues", "errors", "backups", "integrations"}
		)
