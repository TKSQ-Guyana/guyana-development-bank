"""Cluster flow: facilitator forms -> invite -> notify -> join -> head -> file ->
personal evidence -> offer.

Every test acts through the portal's own endpoints as the person acting, and
reads the outcome back through another endpoint. The endpoints commit, so
commit is suppressed and each test is rolled back: nothing stays on the site.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_cluster_flow
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import api, documents, offers, profiles
from gdb_bank.security import role_policy
from gdb_bank.services import cluster as cluster_service

FACILITATOR = "test-gdb-facilitator@example.gy"
OTHER_FACILITATOR = "test-gdb-facilitator2@example.gy"
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

PLAN = {"plan_executive_summary": "Shared cold store", "plan_shared_project": "Cold store at Parika"}


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
		_user(FACILITATOR, "Facilitator")
		_user(OTHER_FACILITATOR, "Facilitator")
		_user(UNDERWRITER, "Loan Underwriter")
		_user(DISBURSER, "Disbursement Officer")
		_user(BOTH, "Loan Underwriter", "Disbursement Officer")

		with self.set_user(FACILITATOR):
			self.cluster = api.create_cluster(
				cluster_name=f"Test {frappe.generate_hash(length=8)}",
				group_purpose="Cassava processing",
				region="Region 3",
			)["name"]
			api.save_cluster_plan(cluster=self.cluster, **PLAN)

	# -- helpers ---------------------------------------------------------------

	def invite(self, eid: str):
		with self.set_user(FACILITATOR):
			api.invite_member(eid=eid, cluster=self.cluster)

	def join(self, user: str):
		self.invite(EIDS[user])
		with self.set_user(user):
			api.respond_to_invitation(cluster=self.cluster, accept=1)

	def headed(self):
		"""HEAD has joined and been named head."""
		self.join(HEAD)
		with self.set_user(FACILITATOR):
			api.set_cluster_head(cluster=self.cluster, eid=EIDS[HEAD])

	def group_application(self) -> str:
		if not frappe.db.get_value("GDB Cluster", self.cluster, "head"):
			self.headed()
		with self.set_user(FACILITATOR):
			return api.save_group_application(
				cluster=self.cluster, loan_amount=500000, purpose="Shared cold store", term_months=12
			)["name"]

	def submit(self, application: str):
		with self.set_user(FACILITATOR):
			api.submit_group_application(cluster=self.cluster, name=application)

	def inbox(self, user: str) -> list:
		"""What the portal's bell reads: Frappe's own Notification Log, as that user."""
		with self.set_user(user):
			return frappe.get_list("Notification Log", fields=["subject", "link", "read"])

	def offered_group_application(self, approver: str = UNDERWRITER) -> tuple[str, str]:
		"""A submitted group case, approved by `approver`, with its offer issued."""
		self.join(MEMBER)
		application = self.group_application()
		self.submit(application)
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

	# -- who may run a group -----------------------------------------------------

	def test_a_citizen_can_neither_form_nor_file_for_a_group(self):
		with self.set_user(HEAD), self.assertRaises(frappe.PermissionError):
			api.create_cluster(cluster_name="Citizen group")
		self.headed()
		with self.set_user(HEAD), self.assertRaises(frappe.PermissionError):
			api.save_application(
				loan_amount=500000, purpose="Cold store", term_months=12, cluster=self.cluster
			)
		with self.set_user(HEAD), self.assertRaises(frappe.PermissionError):
			api.invite_member(eid=EIDS[MEMBER], cluster=self.cluster)

	def test_only_the_groups_own_facilitator_runs_it(self):
		with self.set_user(OTHER_FACILITATOR), self.assertRaises(frappe.PermissionError):
			api.invite_member(eid=EIDS[MEMBER], cluster=self.cluster)
		with self.set_user(OTHER_FACILITATOR), self.assertRaises(frappe.PermissionError):
			api.save_cluster_plan(cluster=self.cluster, plan_market="Mine now")

	def test_the_head_must_have_accepted(self):
		self.invite(EIDS[HEAD])
		with self.set_user(FACILITATOR), self.assertRaises(frappe.ValidationError):
			api.set_cluster_head(cluster=self.cluster, eid=EIDS[HEAD])

	def test_the_head_is_fixed_once_the_group_has_an_application(self):
		self.join(MEMBER)
		self.group_application()
		with self.set_user(FACILITATOR), self.assertRaises(frappe.ValidationError):
			api.set_cluster_head(cluster=self.cluster, eid=EIDS[MEMBER])

	def test_the_head_cannot_submit_or_discard_the_group_draft(self):
		application = self.group_application()
		with self.set_user(HEAD), self.assertRaises(frappe.PermissionError):
			api.submit_application(name=application)
		with self.set_user(HEAD), self.assertRaises(frappe.PermissionError):
			api.discard_application(name=application)

	def test_a_retried_first_save_does_not_open_a_second_draft(self):
		first = self.group_application()
		self.assertEqual(self.group_application(), first)

	def test_submission_needs_an_accepted_member(self):
		application = self.group_application()
		self.invite(EIDS[MEMBER])  # invited, not joined
		with self.assertRaises(frappe.ValidationError):
			self.submit(application)

	def test_submission_needs_the_plan(self):
		self.join(MEMBER)
		application = self.group_application()
		with self.set_user(FACILITATOR):
			api.save_cluster_plan(cluster=self.cluster, plan_shared_project="")
		with self.assertRaises(frappe.ValidationError):
			self.submit(application)

	def test_the_plan_is_locked_once_submitted(self):
		self.join(MEMBER)
		self.submit(self.group_application())
		with self.set_user(FACILITATOR), self.assertRaises(frappe.ValidationError):
			api.save_cluster_plan(cluster=self.cluster, plan_market="Changed")

	def test_a_facilitator_holds_no_other_role(self):
		self.assertIsNotNone(role_policy.refusal_to_combine(["Facilitator", "Loan Underwriter"]))
		self.assertIsNone(role_policy.refusal_to_combine(["Facilitator"]))
		with self.set_user(FACILITATOR), self.assertRaises(frappe.PermissionError):
			api.all_loans()

	# -- membership --------------------------------------------------------------

	def test_a_member_who_joins_sees_the_group_application(self):
		self.join(MEMBER)
		application = self.group_application()

		for user, sees in ((HEAD, True), (MEMBER, True), (OUTSIDER, False)):
			with self.set_user(user):
				names = [row["name"] for row in api.my_loans()]
			self.assertEqual(application in names, sees, user)

	def test_a_member_does_not_see_the_heads_contact(self):
		self.join(MEMBER)
		self.headed()
		with self.set_user(HEAD):
			profiles.save_profile(
				date_of_birth="1990-01-01", phone="600 1234", email=HEAD, address="Parika"
			)
		application = self.group_application()

		with self.set_user(HEAD):
			head_view = api.loan_detail(name=application)
		with self.set_user(MEMBER):
			member_view = api.loan_detail(name=application)

		self.assertTrue(head_view["phone"])
		self.assertIsNone(member_view["phone"])

	def test_the_review_queue_holds_submitted_cases_and_what_they_miss(self):
		self.join(MEMBER)
		application = self.group_application()
		with self.set_user(UNDERWRITER):
			self.assertNotIn(application, [r["name"] for r in api.all_loans()["rows"]])
		self.submit(application)

		with self.set_user(UNDERWRITER):
			row = next(r for r in api.all_loans()["rows"] if r["name"] == application)
		self.assertEqual(row["evidence_missing"], ["Identity", "Personal Financials"])

	# -- notifications -----------------------------------------------------------

	def test_an_invited_citizen_is_notified(self):
		self.invite(EIDS[MEMBER])

		self.assertEqual(
			[(n.link, n.read) for n in self.inbox(MEMBER)], [(cluster_service.INVITATIONS_LINK, 0)]
		)
		self.assertEqual(self.inbox(OUTSIDER), [])

	def test_the_facilitator_hears_the_answer(self):
		self.join(MEMBER)
		self.assertIn(
			cluster_service.FACILITATOR_LINK.format(self.cluster), [n.link for n in self.inbox(FACILITATOR)]
		)

	def test_an_unregistered_eid_is_notified_on_first_sign_in(self):
		self.invite(EIDS[NEWCOMER])
		_user(NEWCOMER, "Citizen")
		self.assertEqual(self.inbox(NEWCOMER), [])

		cluster_service.link_pending_invitations(NEWCOMER, EIDS[NEWCOMER])

		self.assertEqual([n.link for n in self.inbox(NEWCOMER)], [cluster_service.INVITATIONS_LINK])

	def test_the_head_is_told_the_application_went_in_their_name(self):
		self.join(MEMBER)
		application = self.group_application()
		self.submit(application)
		self.assertIn(f"/loans/{application}", [n.link for n in self.inbox(HEAD)])

	def test_every_signatory_is_notified_when_the_offer_is_issued(self):
		application, _offer = self.offered_group_application()

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

	def test_the_head_and_a_member_each_owe_personal_evidence(self):
		self.join(MEMBER)
		application = self.group_application()

		head, member = self.shelf(HEAD, application), self.shelf(MEMBER, application)

		self.assertEqual(head["missing"], ["Identity", "Personal Financials"])
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
		self.headed()
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
		for viewer in (HEAD, FACILITATOR):
			self.assertIsNone(profile_seen_by(viewer), viewer)

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

	def test_a_moratorium_runs_from_the_offer_to_the_agreement_and_the_loan(self):
		import io
		import re
		import zipfile

		self.join(MEMBER)
		application = self.group_application()
		self.submit(application)
		with self.set_user(UNDERWRITER):
			api.review_loan(name=application, action="approve")
			# A moratorium GDB does not offer is refused at issue.
			with self.assertRaises(frappe.ValidationError):
				offers.issue_offer(application=application, moratorium_months=5)
			offer = offers.issue_offer(application=application, moratorium_months=3)["name"]

		row = frappe.db.get_value("GDB Loan Offer", offer, ["moratorium_months", "agreement_text"], as_dict=True)
		self.assertEqual(row.moratorium_months, 3)
		self.assertIn("Moratorium    : 3 months after disbursement", row.agreement_text)
		self.assertIn("first falls due in month 4", row.agreement_text)

		with self.set_user(HEAD):
			offers.agreement_docx(name=offer)
		xml = zipfile.ZipFile(io.BytesIO(frappe.local.response.filecontent)).read("word/document.xml").decode()
		text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml))
		self.assertIn("A moratorium of 3 months applies", text)
		self.assertIn("the 4th month after disbursement", text)

		self.sign(offer)
		with self.set_user(DISBURSER):
			api.book_loan(application=application)
		loan = frappe.db.get_value("Loan", {"loan_application": application, "docstatus": 1})

		# lending's schedule: the first instalment three months on from where it
		# would otherwise fall, then all 12 of the term, equal.
		from frappe.utils import add_months, getdate, nowdate

		from gdb_bank.services.disbursement import release_funds

		with self.set_user("Administrator"):
			release_funds(frappe.get_doc("Loan", loan), 500000, DISBURSER)
		schedule = frappe.get_all("Loan Repayment Schedule", {"loan": loan, "docstatus": 1}, pluck="name")
		rows = frappe.get_all(
			"Repayment Schedule",
			{"parent": schedule[0]},
			["payment_date", "total_payment"],
			order_by="payment_date asc",
		)
		due = [r for r in rows if r.total_payment > 0]
		# Twelve instalments. lending may add one empty "broken period" row ahead
		# of them, for the gap before the first one; it has nothing due.
		self.assertEqual(len(due), 12)
		self.assertLessEqual(len(rows) - len(due), 1)
		self.assertEqual(sum(r.total_payment for r in due), 500000)
		# Due one month after release plus the three-month moratorium.
		self.assertEqual(getdate(due[0].payment_date), getdate(add_months(nowdate(), 4)))


	def test_an_issued_offer_downloads_as_the_gdb_loan_agreement(self):
		import io
		import re
		import zipfile

		_, offer = self.offered_group_application()
		row = frappe.db.get_value("GDB Loan Offer", offer, ["applicant_name", "term_months"], as_dict=True)
		with self.set_user(HEAD):
			offers.agreement_docx(name=offer)
		self.assertEqual(frappe.local.response.type, "download")
		self.assertTrue(frappe.local.response.filename.endswith(".docx"))
		xml = zipfile.ZipFile(io.BytesIO(frappe.local.response.filecontent)).read("word/document.xml").decode()
		text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml))
		self.assertNotIn("{{", xml)
		self.assertIn(f"Repayable in {row.term_months} months", text)
		self.assertIn(row.applicant_name.upper(), text)
		with self.set_user(OUTSIDER), self.assertRaises(frappe.PermissionError):
			offers.agreement_docx(name=offer)
