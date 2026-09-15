Phase 1 — Guyana Development Bank Lending Platform
Core Development Rule
Build Phase 1 of the Guyana Development Bank Lending Platform on top of Frappe only.
Frappe must be the authoritative backend and API layer.
Mandatory architecture rules
1.	Use Frappe DocTypes as the primary data model.
2.	Use Frappe REST/RPC/API mechanisms for frontend-to-backend communication.
3.	Use Frappe server-side Python methods for business logic and validations.
4.	Use Frappe Roles, Role Permissions, User Permissions and permission hooks for authorization.
5.	Use Frappe Workflows where workflow/state transitions are required.
6.	Use Frappe File/Attachment functionality for evidence and documents.
7.	Use Frappe Communication/Notification mechanisms where applicable.
8.	Use Frappe Audit/Version/Activity mechanisms for auditability where appropriate.
9.	Do not create a separate Node.js/Express/FastAPI/Django backend.
10.	Do not create a second database.
11.	Do not access MariaDB/PostgreSQL directly from the frontend.
12.	Do not bypass Frappe permissions through custom APIs.
13.	Do not duplicate Frappe's authentication/authorization system unnecessarily.
14.	External government, Coursera, My Guyana, credit bureau, screening and Bank of Guyana systems must be integrated through controlled Frappe-side integration adapters/services.
15.	If an external integration is unavailable, implement the documented/manual fallback rather than inventing an external API.
The SOW states that My Guyana supplies authenticated identity and that the lending platform itself does not perform identity verification.
________________________________________
PHASE 1 SCOPE
Phase 1 includes the MVP functionality only.
The launch products are:
•	SME Direct Loan — maximum G$3,000,000, 0% interest
•	Quick Loan — maximum G$300,000, 0% interest
The co-financed facility is deferred and must NOT be implemented as a Phase 1 product.
Do not implement Phase 2 AI capabilities.
Do not implement functionality explicitly identified as out of scope.
________________________________________
DEVELOPMENT APPROACH
Develop in this order:
1.	Platform foundation
2.	Applicant / Borrower
3.	Field Officer
4.	Facilitator
5.	Sector Specialist
6.	Underwriter
7.	Disbursement Officer
8.	Finance Department
9.	Board / CEO
10.	Platform Administrator
11.	End-to-end integration testing
Do not build isolated screens without connecting them to the actual Frappe data model and workflow.
Every feature must have:
Persona
→ User action
→ Frappe DocType
→ Frappe API
→ Server-side validation
→ Role/permission
→ Workflow/state transition
→ Audit record
→ Notification where required
→ UI
→ Test
________________________________________
0. PLATFORM FOUNDATION
Before implementing persona features, establish the Frappe foundation.
Create/configure:
Roles
•	Applicant
•	Borrower
•	Field Officer
•	Facilitator
•	Sector Specialist
•	Underwriter
•	Disbursement Officer
•	Finance Department
•	Platform Admin
•	Board / CEO
Use Frappe role and permission mechanisms.
The SOW requires decision rights and access scope to be enforced through the role and permission model.
Core configuration
Create/configure DocTypes for:
•	Loan Product
•	Sector
•	Sub-sector
•	Priority Group
•	Region
•	Person / Applicant
•	Business
•	Loan Application
•	Application Evidence
•	Training Requirement
•	Training Enrollment / Completion
•	Cluster
•	Cluster Member
•	Cluster Plan
•	Site Visit
•	Verification Check
•	Assessment
•	Specialist Input
•	Credit Decision
•	Conditions Precedent
•	Offer
•	Facility / Loan Account
•	Disbursement
•	Repayment
•	Ledger Entry
•	Monitoring Visit
•	Concern / Exception
•	Notification/communication records where required
•	Audit/event records where required
Do not blindly create all DocTypes before understanding relationships. First inspect the existing Frappe/ERPNext installation and reuse suitable existing DocTypes where they satisfy the requirement.
________________________________________
1. APPLICANT / BORROWER
Persona objective:
The applicant applies for a facility and, after funding, manages their loan.
The applicant has access only to their own applications, documents, loans and statements. They have no credit decision authority except accepting or declining an offer.
Features
1.1 Program Information
Implement:
•	Program information
•	Loan products
•	Maximum amount
•	0% interest
•	No collateral
•	Eligible sectors
•	"Other — value creation" sector route
•	Priority groups
•	Readiness/document checklist
•	Mobile/low-bandwidth-friendly experience
Program terms must come from Frappe configuration, not hardcoded frontend values.
1.2 Identity / Registration
Integrate authenticated identity supplied by My Guyana.
Store:
•	GUIN/RIDN permanent identifier
•	identity source
•	identity verification status
•	national-ID fallback status
•	consent
•	consent version
•	consent timestamp
Never use card Document Number or CAN as the permanent person identifier.
Prevent duplicate person records.
Identity must be implemented as an adapter so the authentication provider can change without changing the core data model.
These requirements are explicitly specified in R-008 through R-014.
1.3 Guided Application
Implement:
•	Existing business application
•	New venture application
•	Conditional sections based on application type
•	Financial information
•	Business plan
•	Vision
•	Mission
•	Goals
•	Customer segments
•	Target market
•	Ecosystem
•	Operations
•	Team
•	Strategy
•	Requested amount
•	Purpose
•	Sector/sub-sector
•	Priority-group declaration
Allow:
•	Save progress
•	Resume later
•	Section-by-section completion
•	Progress indicator
•	Outstanding-items indicator
•	Reuse previously supplied information
•	Amount ceiling validation
•	Submission blocking when required information/evidence/training is missing
•	Withdrawal before decision
The SOW explicitly requires the guided application to save sections and support resumption without data loss.
1.4 Evidence
Implement:
•	Upload document
•	Document classification
•	Financials
•	Business plan
•	Identity
•	Proof of address
•	Other
•	Document shelf
•	Status
•	File type/size validation
•	Provenance
•	Applicant-supplied vs officer-captured evidence
•	Replacement of documents
Use Frappe's file/attachment mechanisms rather than building a separate file-storage backend unless the existing Frappe deployment requires an external object store.
1.5 Application Tracking
Applicant must see:
•	Current application status
•	Plain-language explanation
•	What happens next
•	Information requests
•	Actionable outstanding items
•	Status notifications
Never expose:
•	Internal assessment scores
•	Compliance results
•	Underwriting notes
1.6 Offer
Implement:
•	Generate offer from recorded decision
•	Amount
•	Term
•	Schedule
•	Conditions
•	Applicant acceptance
•	Applicant decline
•	Decline reason
•	Offer validity
•	Expiry
•	Retained execution record
•	Downloadable executed record
Use one authoritative Offer record/document.
1.7 Borrower Self-Service
After funding:
•	Current balance
•	Next instalment
•	Schedule
•	Payment history
•	Repayment recording
•	Statement generation
Balances must be derived from the ledger rather than manually maintained duplicated values.
________________________________________
________________________________________
5. UNDERWRITER
The Underwriter is the sole credit decision authority.
Features
5.1 Queue
Implement:
•	Underwriting queue
•	Assignment
•	Case status
•	Priority
•	Assigned Underwriter
•	Queue filtering
5.2 Case Workspace
Show:
•	Applicant
•	Business
•	Application
•	Evidence
•	Verification results
•	Assessment
•	Specialist input
•	Training
•	Conditions
•	Previous relevant events
Evidence must be traceable to its source.
5.3 Verification
Implement checks for:
•	Identity
•	Business registration
•	Tax compliance
•	Social insurance
•	Credit history
•	Sanctions
•	PEP
•	Adverse media
•	Bank account
•	Directors
•	Beneficial owners
Every check records:
Source
Timestamp
Result
Reference
Unavailable is a distinct state.
Never convert:
Unavailable → Pass
An unavailable external check must not automatically block the case from reaching human review.
Support re-running a check while retaining the previous result.
5.4 Structured Assessment
Create a structured assessment based on verified evidence.
Verified evidence must outrank self-declared evidence.
5.5 Credit Decision
Implement:
•	Approve
•	Decline
•	Approved amount
•	Term
•	Rationale
•	Decision date
•	Underwriter identity
•	Conditions
•	Decision evidence
Approved amount cannot exceed product ceiling.
Do not implement AI-based credit decisions in Phase 1.
5.6 Specialist Referral
Implement:
Underwriter
→ Refer case
→ Sector Specialist
→ Specialist input
→ Underwriter review
→ Final human decision
Specialist cannot decide the case.
________________________________________
6. DISBURSEMENT OFFICER
The Disbursement Officer has no credit authority. They execute only decided and condition-complete cases.
Features
6.1 Conditions
Implement:
•	Generate conditions from decision/product configuration
•	Applicant-visible checklist
•	Staff verification
•	Timestamp
•	Staff attribution
•	Condition status
Prevent release when any required condition is incomplete.
Re-derive entitlement and authorizations at release time.
6.2 Release
Implement:
Approved decision
→ Conditions complete
→ Training re-check
→ Verified bank account
→ Disbursement Officer authorization
→ Payment instruction
→ Disbursement ledger event
→ Borrower receipt confirmation
No scheduled/automatic release.
Only the verified nominated bank account may receive funds.
The SOW explicitly requires separation of duties: the deciding Underwriter cannot authorize release.
6.3 Reconciliation
Implement:
•	Payment instruction reference
•	Disbursement status
•	Bank response
•	Reconciliation
•	Exception
•	Borrower receipt confirmation
Do not create an automatic money-movement engine that bypasses human authorization.
________________________________________
Portfolio
Provide aggregate views for:
•	Applications
•	Approved loans
•	Disbursed amount
•	Outstanding balances
•	Repayments
•	Arrears
•	Portfolio status
•	Region
•	Sector
•	Product
•	Priority group
Reconciliation
Provide:
•	Disbursement reconciliation
•	Repayment recording/visibility
•	Exceptions
•	Outstanding exceptions
Finance must not receive unrestricted case-level underwriting evidence if the persona model prohibits it.
________________________________________
8. BOARD / CEO
Board/CEO has governance authority only.
They must receive aggregate information and must not receive individual case-level credit/compliance detail.
Implement dashboard/reporting for:
•	Capital deployed
•	Number of applicants
•	Applications by status
•	Approval volume
•	Disbursement volume
•	Portfolio health
•	Repayments
•	Arrears
•	Reach
•	Region
•	Sector
•	Priority groups
•	Product performance
Do not expose:
•	Individual case evidence
•	Individual underwriting notes
•	Individual compliance results
•	Individual credit decision detail
________________________________________
9. PLATFORM ADMIN
Platform Admin manages the system but has no credit or money authority.
Implement:
User administration
•	Create/manage users
•	Assign roles
•	Region assignment
•	Sector assignment
•	Activate/deactivate access
Configuration
•	Product configuration
•	Sector configuration
•	Region configuration
•	Training configuration
•	Curriculum configuration
•	Permission configuration
Audit
Provide visibility into:
•	Login/access events where supported
•	Record changes
•	Workflow transitions
•	Decisions
•	Disbursement events
•	Integration events
•	Consent
•	External verification events
Integration health
Show:
•	My Guyana integration
•	Government registry integration
•	Credit bureau
•	Screening provider
•	Coursera
•	Bank of Guyana
•	SMS/email
with:
•	Status
•	Last successful call
•	Last failure
•	Error information
•	Retry capability where appropriate
Platform Admin must never receive credit decision authority merely because they have system administration privileges.
________________________________________
10. FRAPPE API CONTRACT
For every frontend feature, expose/use a controlled Frappe API.
Prefer:
/api/resource/{DocType}
for straightforward CRUD where appropriate.
For business operations, use controlled whitelisted Frappe methods such as:
/api/method/{app}.{module}.api.{method}
Business operations must execute server-side.
Examples:
submit_application()
withdraw_application()
accept_offer()
decline_offer()
assign_underwriter()
refer_to_specialist()
record_specialist_input()
make_credit_decision()
verify_condition()
authorize_disbursement()
record_disbursement()
record_repayment()
generate_statement()
Do not implement critical business transitions as frontend-only logic.
________________________________________
11. WORKFLOW
Model the loan lifecycle explicitly.
At minimum establish states corresponding to:
Draft
→ In Progress
→ Submitted
→ Verification
→ Assessment
→ Underwriting
→ Specialist Review (when required)
→ Approved / Declined
→ Offer
→ Accepted / Declined / Expired
→ Conditions
→ Ready for Disbursement
→ Disbursed
→ Servicing
Add withdrawal/cancellation/error states only where required by the requirements.
Every state transition must:
•	Validate permissions
•	Validate prerequisites
•	Record actor
•	Record timestamp
•	Record transition
•	Prevent unauthorized transitions
________________________________________
12. SECURITY MODEL
Implement least privilege.
Test each persona explicitly.
Applicant
Can see:
Own data only
Own applications
Own documents
Own offers
Own loans
Own statements
Underwriter
Can see:
Assigned cases
Full case evidence
Disbursement Officer
Can see:
Condition-complete decided cases
Disbursement information
Training completion needed for release
Finance
Can see:
Product configuration
Aggregate portfolio
Board / CEO
Can see:
Aggregate governance reporting
Platform Admin
Can see:
Administration
Configuration
Audit/integration health
Never assume frontend hiding is sufficient. Enforce all restrictions server-side through Frappe permissions.
________________________________________
13. TESTING RULE
For every feature, create:
1.	Happy-path test
2.	Validation test
3.	Permission test
4.	Unauthorized access test
5.	Workflow/state test
6.	Audit test
7.	API test
8.	Error handling test
For every persona test both:
What they CAN access
and:
What they MUST NOT access
________________________________________
15. IMPORTANT AGENT BEHAVIOUR
Before writing code for a feature:
1.	Read the relevant Phase 1 requirement.
2.	Identify the persona.
3.	Identify the required DocTypes.
4.	Inspect existing Frappe/ERPNext DocTypes before creating new ones.
5.	Determine the required role permissions.
6.	Determine the workflow/state transition.
7.	Determine the required API.
8.	Implement server-side validation.
9.	Implement UI.
10.	Write tests.
11.	Verify the API independently.
12.	Verify unauthorized access.
13.	Only then mark the feature complete.
Never invent requirements.
If the SOW does not specify something:
DO NOT silently invent business behaviour.
Instead:
FLAG: REQUIREMENT CLARIFICATION NEEDED
If an external API contract is unavailable:
Create an integration adapter/interface
+
Mock/sandbox implementation
+
Document required external contract
Do not hardcode fake production integration behaviour.
________________________________________

