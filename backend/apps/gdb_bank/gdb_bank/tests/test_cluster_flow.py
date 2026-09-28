"""Cluster flow: invite -> notify -> join -> personal evidence -> offer.

Every test acts through the portal's own endpoints as the person acting, and
reads the outcome back through another endpoint. The endpoints commit, so
commit is suppressed and each test is rolled back: nothing stays on the site.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_cluster_flow
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import api, documents, offers, profiles
from gdb_bank.services import cluster as cluster_service

HEAD = "test-gdb-head@example.gy"
MEMBER = "test-gdb-member@example.gy"
OUTSIDER = "test-gdb-outsider@example.gy"
NEWCOMER = "test-gdb-newcomer@example.gy"
UNDERWRITER = "test-gdb-underwriter@example.gy"
DISBURSER = "test-gdb-disburser@example.gy"
BOTH = "test-gdb-both@example.gy"  # holds the deciding AND the releasing role

EIDS = {
	HEAD: "592-9000-0001",
	MEMBER: "592-9000-0002",
	OUTSIDER: "592-9000-0003",
	NEWCOMER: "592-9000-0004",
}


def _user(email: str, *roles: str) -> None:
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": email.split("@")[0].removeprefix("test-gdb-").title(),
			"send_welcome_email": 0,
			"roles": [{"role": role} for role in roles],
		}
	).insert(ignore_permissions=True)
	if email in EIDS:
		frappe.db.set_value("User", email, "gdb_eid", EIDS[email])


class TestClusterFlow(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)

		for email in (HEAD, MEMBER, OUTSIDER):
			_user(email, "Citizen")
		_user(UNDERWRITER, "Loan Underwriter")
		_user(DISBURSER, "Disbursement Officer")
		_user(BOTH, "Loan Underwriter", "Disbursement Officer")

		with self.set_user(HEAD):
			self.cluster = api.create_cluster(cluster_name=f"Test {frappe.generate_hash(length=8)}")["name"]

	# -- helpers ---------------------------------------------------------------

	def invite(self, eid: str):
		with self.set_user(HEAD):
			api.invite_member(eid=eid, cluster=self.cluster)

	def join(self, user: str):
		self.invite(EIDS[user])
		with self.set_user(user):
			api.respond_to_invitation(cluster=self.cluster, accept=1)

	def group_application(self, **extra) -> str:
		with self.set_user(HEAD):
			return api.save_application(
				loan_amount=500000, purpose="Shared cold store", term_months=12, cluster=self.cluster, **extra
			)["name"]

	def inbox(self, user: str) -> list:
		"""What the portal's bell reads: Frappe's own Notification Log, as that user."""
		with self.set_user(user):
			return frappe.get_list("Notification Log", fields=["subject", "link", "read"])

	def offered_group_application(self, approver: str = UNDERWRITER) -> tuple[str, str]:
		"""A submitted group case, approved by `approver`, with its offer issued."""
		self.join(MEMBER)
		application = self.group_application()
		with self.set_user(HEAD):
			api.submit_application(name=application)
		with self.set_user(approver):
			api.review_loan(name=application, action="approve")
			offer = offers.issue_offer(application=application)["name"]
		return application, offer

	def sign(self, offer: str):
		for user, typed in ((HEAD, "Head"), (MEMBER, "Member")):
			with self.set_user(user):
				offers.sign_offer(name=offer, signed_name=typed)

	def shelf(self, user: str, application: str, **kwargs) -> dict:
		with self.set_user(user):
			return documents.list_documents(application=application, **kwargs)

	# -- membership --------------------------------------------------------------

	def test_a_member_who_joins_sees_the_group_application(self):
		self.join(MEMBER)
		application = self.group_application()

		for user, sees in ((MEMBER, True), (OUTSIDER, False)):
			with self.set_user(user):
				names = [row["name"] for row in api.my_loans()]
			self.assertEqual(application in names, sees, user)

	def test_a_member_does_not_see_the_heads_contact_or_income(self):
		self.join(MEMBER)
		application = self.group_application(phone="600 1234", monthly_income=50000)

		with self.set_user(HEAD):
			head_view = api.loan_detail(name=application)
		with self.set_user(MEMBER):
			member_view = api.loan_detail(name=application)
			listed = next(r for r in api.my_loans() if r["name"] == application)

		self.assertTrue(head_view["phone"] and head_view["monthly_income"])
		for view in (member_view, listed):
			self.assertEqual((view["phone"], view["monthly_income"]), (None, None))

	def test_the_review_queue_holds_submitted_cases_and_what_they_miss(self):
		application = self.group_application()
		with self.set_user(UNDERWRITER):
			self.assertNotIn(application, [r["name"] for r in api.all_loans()])
		with self.set_user(HEAD):
			api.submit_application(name=application)
			with self.assertRaises(frappe.PermissionError):
				api.all_loans()

		with self.set_user(UNDERWRITER):
			row = next(r for r in api.all_loans() if r["name"] == application)
		self.assertEqual(row["evidence_missing"], ["Identity", "Personal Financials"])

	# -- notifications -----------------------------------------------------------

	def test_an_invited_citizen_is_notified(self):
		self.invite(EIDS[MEMBER])

		self.assertEqual(
			[(n.link, n.read) for n in self.inbox(MEMBER)], [(cluster_service.INVITATIONS_LINK, 0)]
		)
		self.assertEqual(self.inbox(OUTSIDER), [])

	def test_an_unregistered_eid_is_notified_on_first_sign_in(self):
		self.invite(EIDS[NEWCOMER])
		_user(NEWCOMER, "Citizen")
		self.assertEqual(self.inbox(NEWCOMER), [])

		cluster_service.link_pending_invitations(NEWCOMER, EIDS[NEWCOMER])

		self.assertEqual([n.link for n in self.inbox(NEWCOMER)], [cluster_service.INVITATIONS_LINK])

	def test_every_signatory_is_notified_when_the_offer_is_issued(self):
		self.join(MEMBER)
		application = self.group_application()
		with self.set_user(HEAD):
			api.submit_application(name=application)
		with self.set_user(UNDERWRITER):
			api.review_loan(name=application, action="approve")
			offers.issue_offer(application=application)

		for user in (HEAD, MEMBER):
			self.assertIn(f"/loans/{application}", [n.link for n in self.inbox(user)], user)
			with self.set_user(user):
				self.assertEqual(api.loan_detail(name=application)["stage"], "Signing", user)

	# -- money -------------------------------------------------------------------

	def test_booking_is_the_disbursement_officers_and_waits_for_every_signature(self):
		application, offer = self.offered_group_application()

		with self.set_user(UNDERWRITER), self.assertRaises(frappe.PermissionError):
			api.book_loan(application=application)
		with self.set_user(DISBURSER), self.assertRaises(frappe.ValidationError):
			api.book_loan(application=application)  # issued, not yet signed

		self.sign(offer)
		with self.set_user(DISBURSER):
			self.assertTrue(api.book_loan(application=application)["loan"])

	def test_release_waits_for_the_conditions_and_never_for_the_approver(self):
		application, offer = self.offered_group_application(approver=BOTH)
		self.sign(offer)
		with self.set_user(DISBURSER):
			api.book_loan(application=application)

		with self.set_user(BOTH), self.assertRaises(frappe.PermissionError):
			api.disburse_loan(application=application)  # four eyes
		with self.set_user(DISBURSER), self.assertRaises(frappe.ValidationError):
			api.disburse_loan(application=application)  # conditions precedent outstanding

	# -- evidence ----------------------------------------------------------------

	def test_the_head_owes_business_and_personal_evidence_a_member_only_personal(self):
		self.join(MEMBER)
		application = self.group_application(
			business_stage="Existing", dcra_number="TEST-1", business_name="Test Co"
		)

		head, member = self.shelf(HEAD, application), self.shelf(MEMBER, application)

		self.assertEqual(head["missing"], ["Identity", "Personal Financials", "Financials"])
		self.assertEqual(member["missing"], ["Identity", "Personal Financials"])
		self.assertEqual(member["settings"]["types"], list(documents.PERSONAL_TYPES))
		self.assertTrue(head["can_upload"] and member["can_upload"])

	def test_a_members_personal_financials_are_theirs_and_the_banks(self):
		self.join(MEMBER)
		application = self.group_application()
		with self.set_user(MEMBER):
			doc = documents.new_document(document_type="Personal Financials", application=application)

		self.assertIn(doc.name, [d.name for d in self.shelf(MEMBER, application)["documents"]])
		self.assertNotIn(doc.name, [d.name for d in self.shelf(HEAD, application)["documents"]])
		for staff in (UNDERWRITER, DISBURSER):
			shelf = self.shelf(staff, application, applicant=MEMBER)
			self.assertIn(doc.name, [d.name for d in shelf["documents"]], staff)
			self.assertFalse(shelf["can_upload"], staff)
			self.assertTrue(frappe.has_permission(documents.DOCTYPE, "read", doc=doc.name, user=staff), staff)

	def test_a_members_declared_financials_reach_staff_and_not_the_head(self):
		self.join(MEMBER)
		with self.set_user(MEMBER):
			profiles.save_personal_financials(
				employment_status="Self-employed", monthly_income="80000", monthly_expenses="30000"
			)

		def profile_seen_by(user):
			with self.set_user(user):
				roster = api.cluster_view(cluster=self.cluster)["members"]
			return next(m for m in roster if m["member"] == MEMBER)["profile"]

		for staff in (UNDERWRITER, DISBURSER):
			self.assertEqual(profile_seen_by(staff)["monthly_income"], 80000, staff)
		self.assertIsNone(profile_seen_by(HEAD))

	def test_declared_financials_need_employment_income_and_expenses(self):
		with self.set_user(MEMBER), self.assertRaises(frappe.ValidationError):
			profiles.save_personal_financials(employment_status="Employed", monthly_income="50000")
		with self.set_user(MEMBER), self.assertRaises(frappe.ValidationError):
			profiles.save_personal_financials(
				employment_status="Employed", monthly_income="50000", monthly_expenses="-1"
			)

	def test_business_evidence_is_the_heads_alone(self):
		self.join(MEMBER)
		application = self.group_application()

		with self.set_user(MEMBER), self.assertRaises(frappe.PermissionError):
			documents.new_document(document_type="Financials", application=application)
		with self.set_user(OUTSIDER), self.assertRaises(frappe.PermissionError):
			documents.list_documents(application=application)
