GDB Digital Lending Platform 

Enterprise Applicant Functional and Business Context for Claude Code 

This document is the source of truth for the applicant/borrower journey. It is a business and functional specification, not a demo checklist. Build the complete workflow, including different application routes, business information, financial information, clusters, training, evidence, verification, assessment, conditions, offer execution, payments, schedules, statements and facility closure. 

 

 

 

1. Product context 

Guyana Development Bank is a state development bank providing zero-interest financing to Guyanese SMEs and entrepreneurs, including businesses that may not be able to provide collateral or audited accounts to commercial banks. 

 

The applicant is not buying a product. They are submitting a formal funding application to a state institution. The experience must therefore feel official, transparent, permanent and honest. It must explain what information is requested, which agency confirmed information, why a result was produced, what is still required and what happens next. 

 

The system is a digital lending platform, not a general commercial banking system. 

 

Launch product: zero-interest GDB lending 

Currency: GYD only 

Launch maximum: G$3,000,000 per borrower/product, from configuration 

Interest: Nil 

Collateral: None for the launch product, from configuration 

 

The maximum is not an entitlement. The Underwriter may approve a lower amount based on evidence, repayment capacity, plan readiness and policy. 

 

The platform uses Frappe Framework, ERPNext, Frappe Lending and the custom guyana_development_bank app. Existing Frappe, ERPNext and Lending source code must not be modified. 

 

 

 

2. Applicant and borrower definition 

Before disbursement, the person is an Applicant. After a facility is disbursed, the person is also a Borrower. The same person may hold more than one facility over time, subject to policy. 

 

An applicant may have: 

 

One permanent person record identified by EID.. 

One or more applications according to product and policy. 

Zero or more clusters. 

Independent training records. 

Independent evidence records and versions. 

Zero or more offers. 

Zero or more loan facilities. 

Complete retained application, offer, payment and audit history. 

 

A cluster does not make members jointly liable. Every member is assessed, offered, disbursed and repaid independently. 

 

 

 

3. People and authority around the applicant 

Persona 

Relationship to applicant 

Authority 

Applicant/Borrower 

Owns personal information, application, offer and facility 

May apply, respond, accept/decline and view own records; cannot decide credit or release money 

Field Officer 

May source and assist the applicant 

May capture permitted information, site visits and evidence; cannot decide credit 

Facilitator 

Supports clusters, training follow-up and government support referrals 

No credit authority;  

no training delivery authority 

Sector Specialist 

Gives technical advice on a referred case 

Advisory only; no decision controls;  

no general borrower contact 

Underwriter 

Reviews evidence and assessment 

Sole human credit decision authority 

Disbursement Officer 

Checks conditions and releases approved funds 

May authorize release only; cannot decide credit 

Finance 

Manages products, repayments, reconciliation and portfolio 

No credit decision authority 

Platform Admin 

Manages users, configuration, curriculum setup and system health 

No credit or money authority 

Board/CEO 

Views programme and portfolio performance 

Aggregate reporting only; no case-level data 

 

 

4. Complete applicant journey 

Public programme information 

    ↓ 

Choose how to begin 

    ↓ 

Authenticate through EID FRAPPE 

    ↓ 

Resolve or create one person record usingeid 

    ↓ 

Provide versioned consent 

    ↓ 

  

    ↓ 

Choose existing business (pull existing busines name from dcra associated iwth eid) or new venture 

Choose individual,partnership or cluster-supported route 

    ↓ 

Create or join a cluster if applicable 

    ↓ 

Complete the route-specific guided application 

    ↓ 

Provide business, market, operational, team and financial information provide use of funds etc. 

    ↓ 

Upload and classify evidence 

    ↓ 

  

    ↓ 

Review all information, evidence and outstanding items 

    ↓ 

Submit application 

    ↓ 

System runs/records verification and creates assessment inputs 

    ↓ 

Application enters the human underwriting queue 

    ↓ 

Underwriter reviews evidence, checks, assessment and context 

    ↓ 

Approve, decline, refer or request information 

    ↓ 

If information is requested, applicant responds and resubmits the requested items 

    ↓ 

If approved, system generates the Letter of Offer from the decision 

    ↓ 

Applicant reads, accepts or declines the offer 

    ↓ 

Bank countersignature/execution process is completed according to approved phase (Disbursement Officer) 

    ↓ 

System derives pre-disbursement conditions 

    ↓ 

Applicant completes applicant-side conditions 

    ↓ 

Disbursement Officer verifies all conditions and authorizes release 

    ↓ 

Bank instruction is issued and payment outcome is recorded 

    ↓ 

Applicant confirms receipt 

    ↓ 

Facility becomes active 

    ↓ 

Borrower views schedule, payments, balance, arrears and statements 

    ↓ 

Repayments are recorded from supported channels 

    ↓ 

Facility is closed after full repayment while all history remains available 

 

 

 

5. Entry routes and branching 

The applicant does not enter one identical form. The first decisions change the journey. 

 

5.1 How the applicant starts 

The applicant may: 

 

Start an individual application. 

Create a cluster and invite other members. 

Join an existing cluster by invitation. 

Request facilitator support. 

Continue an existing draft application. 

View an existing borrower facility. 

 

5.2 Existing business or new venture 

After the product/route is selected, the applicant chooses: 

 

Existing business 

New venture 

 

This selection controls which questions, evidence requirements and assessment method are shown. 

 

Existing business route 

The system captures and assesses: 

 

Registered business identity. 

Registration date and status. 

Business region and address. 

Owners, directors and beneficial owners where applicable. 

 

The structured assessment produces repayment-capacity information from evidenced financials. When both declared and evidenced figures exist, evidenced figures take priority and the source is shown. 

 

New venture route 

The system captures and assesses: 

 

Proposed venture identity and structure. 

Vision. 

Mission. 

Customer segments. 

Target market. 

Competitors and ecosystem. 

Products or services. 

Operations and delivery model. 

Team, experience and responsibilities. 

Suppliers and dependencies. 

Strategy. 

Projected revenue. 

Projected costs. 

Expected monthly cash position. 

Requested amount and purpose. 

Sector and subsector. 

Priority-group review (will be inferred from the biodata that will be captured.) 

 

The structured assessment produces plan-readiness information across required plan dimensions. A forecast is clearly identified as a forecast and is not presented as filed revenue. 

 

 

 

6. Public programme information 

The public area must answer the applicant's basic questions before registration: 

 

What the programme is. 

Who it is for. 

What sectors are eligible. 

How the “other — value creation” route works. 

What youth and women priority groups mean in practice. 

Maximum amount. 

Zero-interest terms. 

Collateral requirement. 

Repayment term. 

Application cost. 

Required documents. 

Required training. 

Main stages and expected applicant responsibilities. 

How field assistance works. 

How clusters work. 

How repayment works. 

How personal data and external checks are used. 

 

Policy figures are read from active configuration. They must not be hard-coded in frontend code or page content. 

 

Pages must work on low-bandwidth mobile connections. 

 

 

 

7. Identity, registration and consent 

The GDB platform begins with an authenticated, identity-confirmed person. 

 

Identity rules 

Consume a verified identity assertion from MyGuyana or the approved provider. 

Store permanent GUIN/RIDN as the person key. 

Never use card document number or card access number as the permanent identifier. 

Mark the record for later identity upgrade. 

Prevent duplicate person records for the same permanent identifier. 

Keep applicant and staff authentication contexts separate. 

 

Consent rules 

Before required registry, tax, social insurance, credit or screening checks, capture: 

 

person 

consent category 

consent text 

consent text version 

accepted/rejected status 

time and date 

identity binding 

source/channel 

 

Historical consent must remain retained. A new consent text version does not rewrite previous consent. If new consent arrives, the user must be asked to accept it once again, every time there is an update in any legal text – with a heads up as a banner at the top of the screen asking them to verify the consent non-intrusively, and after the last date has passed, it should flash on the screen as a mandatory modal.  

 

-  

 

 

 

8. Cluster and individual application flow 

Clusters are optional. An applicant can apply alone. 

 

Cluster functions 

An applicant may: 

 

Create a cluster. 

Give the cluster a name. 

Choose region and sector. 

Become cluster head. 

Invite registered members by EID 

Invite people who are not yet registered. 

View invitation status. 

Request facilitator support routed by region. 

Contribute to a shared cluster plan. 

View permitted cluster-level progress. 

 

The cluster maintains member states such as: 

 

Invited 

Active 

Exited 

 

These are internal data states. Citizen-facing labels should be plain, such as “Invitation sent”, “Member”, or “No longer in this group”. 

 

Cluster privacy rules 

A member cannot see another member's financial information. 

A member cannot see another member's evidence, assessment, decision, offer or facility details. 

Shared planning sections are separate from member-specific sections. 

Cluster head/facilitator may edit shared sections according to permission. 

Each member edits only their own member-specific section. 

A cluster plan must never mutate an application, assessment, decision or offer. 

A member's exit must not invalidate another member's application or facility. 

Each member completes their own training. 

There is no joint liability. 

 

Cluster application relationship 

Cluster 

    ├── shared plan 

    └── member 1 → independent application → independent decision → independent facility 

        member 2 → independent application → independent decision → independent facility 

        member 3 → independent application → independent decision → independent facility 

 

 

 

9. Guided application data 

The application is a multi-section, saveable form. The applicant must be able to leave and resume without data loss. 

 

Section A — About the applicant 

Name and identity information from the identity provider. 

EID 

Contact details where permitted. 

Residential/address details. 

Region. 

Priority-group declaration. 

Consent status. 

Existing facilities where applicable. 

 

Information already known from the identity provider should not be requested again unnecessarily. 

 

Section B — Business identity 

Business name. 

Registration number where available. 

Legal/operating structure. 

Registration date. 

Business address. 

Operating region. 

Owners/directors/beneficial owners. 

Sector. 

Subsector. 

Other/value-creation description where the sector is not listed. 

 

Business registry values may appear as confirmed read-only values with the confirming agency and last-checked time. The applicant may report that a line is wrong without directly overwriting the source record. 

 

Section C — Business or venture description 

What the business does. 

Products/services. 

Customers. 

Location and service area. 

Current stage. 

Key challenges. 

Purpose of funding. 

Expected use of funds. 

Employment or development impact where required. 

 

Section D — Market and customers 

Customer segments. 

Target market. 

Customer need/problem. 

How customers are reached. 

Competitors or alternatives. 

Pricing approach where applicable. 

Market size or local demand explanation. 

Suppliers and ecosystem relationships. 

Seasonal or geographic factors. 

 

Section E — Operations 

Operating location. 

Production or service process. 

Equipment and assets. 

Suppliers. 

Inventory or input requirements. 

Delivery method. 

Permits or operating requirements. 

Operational risks. 

Business continuity considerations. 

 

Section F — Team and capability 

Owners and key people. 

Roles and responsibilities. 

Relevant experience. 

Staffing. 

Skills gaps. 

External support required. 

 

Section G — Existing-business financials 

For an existing business, capture: 

 

Revenue by year or period. 

Monthly revenue where required. 

Cost of sales. 

Operating expenses. 

Other costs. 

Existing loan obligations. 

Supplier obligations. 

Taxes or statutory obligations where appropriate. 

Monthly cash inflows. 

Monthly cash outflows. 

Current cash position. 

Bank statement or other evidence references. 

 

The system must distinguish: 

 

Applicant declared 

Registry/provider confirmed 

Document evidenced 

Calculated by system 

 

Section H — New-venture projections 

For a new venture, capture: 

 

Expected sales volume. 

Expected pricing. 

Projected revenue. 

Projected operating costs. 

Initial costs. 

Monthly cash inflows and outflows. 

Expected cash remaining. 

Assumptions behind projections. 

Funding required and use of funds. 

 

The system must show that these are projections, not historical filed results. 

 

Section I — Funding request 

Product. 

Requested amount. 

Purpose of funds. 

Proposed use by category. 

Desired term where the product permits applicant input. 

Nominated bank account. 

Priority-group declaration. 

 

Requested amount is checked against the active product ceiling. The applicant may request less than the ceiling. Approval is determined by the Underwriter. 

 

Section J — Review and declarations 

Before submission, show: 

 

All entered answers. 

Source of each important value. 

Evidence shelf. 

Training completion. 

Consent status. 

Missing items. 

Applicant declaration. 

Confirmation that information is true to the applicant's knowledge. 

Ability to return to an incomplete section. 

 

 

 

10. Documents and evidence 

Evidence is not just a file upload. It is a classified, versioned, reviewable business record. 

 

Evidence categories 

Identity 

Business registration 

Proof of address 

Financial statements or records 

Bank statements 

Business plan 

Market or supplier evidence 

Tax/compliance evidence 

Operating permits 

Site-visit evidence 

Other supporting evidence 

 

The exact required categories are derived from product, application type, sector and policy configuration. 

 

Evidence functions 

The applicant can: 

 

See required evidence. 

Upload a document. 

Choose its classification. 

See file type and size requirements. 

See upload progress. 

Retry an interrupted upload. 

Replace a document while replacement is allowed. 

See whether it is awaiting review, accepted or needs replacement. 

Respond to a request for a specific document. 

View permitted document metadata. 

Download permitted documents. 

 

Evidence record 

Store: 

 

evidence ID 

application/facility 

category 

file reference 

version 

supplier 

source route 

uploaded by 

applicant-supplied or officer-captured 

created time 

review status 

reviewed by 

review time 

replacement relationship 

retention metadata 

malware scan status 

text extraction status where applicable 

 

Never destroy the prior version when a document is replaced. 

 

 

 

11. Training and support programmes 

Training is delivered through Coursera or the configured training provider. The Ministry provides the curriculum content; GDB administers the required modules and records completion. 

 

The system must: 

 

Configure required modules by product and sector. 

Create or record applicant enrolment. 

Synchronize module completion. 

Show module-by-module completion and completion dates. 

Show incomplete modules clearly. 

Gate application submission where training is mandatory. 

Re-check completion before disbursement. 

Track training separately for every cluster member. 

Never let a cluster head complete training for another member. 

Show facilitator follow-up needs. 

Signpost approved government support programmes with provenance and last-verified date. 

 

Training incomplete is different from a failed credit check. These must be explained separately to the applicant. 

 

 

 

12. Verification and assessment flow 

After submission, the system records or requests checks from approved sources. 

 

Verification sources 

Possible checks include: 

 

MyGuyana identity assertion. 

Business registry. 

GRA tax compliance through the approved interface. 

Social insurance compliance. 

Credit bureau history and repayment track record. 

Sanctions, PEP and adverse-media screening. 

Nominated bank-account verification. 

Directors and beneficial owners, not only the business entity. 

 

Each check stores: 

 

check type 

subject 

source/provider 

request reference 

requested timestamp 

result timestamp 

result 

source response reference 

availability 

expiry/recheck date 

prior-result relationship 

 

Allowed check outcomes include: 

 

Pass 

Fail 

Unavailable 

Manual review 

Pending 

 

Unavailable is never converted into Pass. An unavailable check must not automatically block an application from proceeding to human review. A check can be re-run while the prior result remains retained. 

 

Assessment branches (AI-assisted, Phase 2) 

Existing business 

Produce a repayment-capacity assessment from evidenced financials, including relevant revenue, costs, obligations and cash position. 

 

New venture 

Produce a plan-readiness assessment across required plan dimensions, including market, operations, team, strategy, assumptions and projected finances. 

 

Assessment records: 

 

inputs consumed 

input sources 

source values 

calculated values 

configuration version 

created time 

invalidated time/reason 

 

If an input changes, the assessment becomes stale or invalid and must be recalculated. An assessment is analysis for the human Underwriter, never a decision or recommendation to approve. 

 

The applicant-facing result must use plain language and must not expose internal scores or confidential assessment notes. 

 

 

 

13. Human underwriting and decision 

Every submitted application enters the underwriting queue. There is no bypass. 

 

The Underwriter sees a case workspace containing: 

 

Applicant and business information. 

Application sections. 

Evidence and document provenance. 

Verification results. 

Assessment inputs and calculations. 

Sector context where applicable. 

Cluster context without other members' financial information. 

Information requests. 

Stage-level observations. 

Queue age and time in state. 

 

The Underwriter may choose exactly one: 

 

Approve 

Decline 

Refer for specialist input 

Request information 

 

A decision requires: 

 

Rationale. 

Named Underwriter. 

Timestamp. 

Evidence state at decision time. 

Approved amount if approved. 

Term and repayment schedule inputs if approved. 

Authority validation if an approval matrix applies. 

 

The system must never automatically approve or decline. AI, integration results and assessment outputs may assist review but cannot replace the named human decision. 

 

The applicant sees a customer-safe outcome and next step, not internal scores, compliance details, queue data or underwriting notes. 

 

 

 

14. The applicant-facing result screen 

The applicant should distinguish three different situations: 

 

More information is needed 

Meaning: the system or Underwriter does not yet have enough evidence to complete review. 

 

Show: 

 

What is missing. 

Why it is needed. 

How to provide it. 

Whether the applicant can edit a section or upload evidence. 

 

A verification did not pass 

Meaning: a named provider returned a negative result. 

 

Show only the approved customer-safe explanation and permitted next action. Do not expose confidential screening detail. 

 

Do not present a false appeal form if the policy says the result cannot be changed by explanation. 

 

A result is not available yet 

Meaning: information is pending or an external provider is unavailable. 

 

Show: 

 

Which check is pending/unavailable where disclosure is permitted. 

That the application is not automatically approved or failed because of this. 

What the applicant can do, if anything. 

 

These situations must not be represented by one vague status or one generic error message. 

 

 

 

15. Eligibility/assessment explanation 

Where the product displays an indicative amount or derived capacity, it must show the reason directly beneath the figure. 

 

Example for an existing business: 

 

Indicative amount 

G$1,200,000 

  

How this was worked out 

Your evidenced annual revenue of G$4,800,000 supports the configured 

capacity calculation of G$1,200,000. The programme maximum is G$3,000,000. 

The final amount is decided by an Underwriter. 

 

Example for a new venture: 

 

Your projected revenue is G$3,000,000. Because this is a forecast rather 

than filed historical revenue, the configured policy applies a more 

cautious calculation. This produces an indicative capacity of G$300,000. 

The final amount is decided by an Underwriter. 

 

Do not display a derived amount without its source, configuration basis and explanation. Do not call an assessment result an approval. 

 

 

 

16. Letter of Offer and execution 

An approved decision creates one authoritative Letter of Offer. Staff and applicant views use the same generated document and terms. 

 

The offer contains: 

 

Applicant and business identity. 

Facility amount. 

Currency. 

Nil interest. 

Term. 

Repayment schedule. 

Conditions. 

Nominated account or release details where safe. 

Validity period. 

Acceptance instructions. 

Bank countersignature/execution section as required. 

 

The system must not ask staff or applicant to re-enter approved terms. 

 

The applicant can: 

 

Read the complete offer. 

Download it. 

Accept it via e-signature (note to AI, ask your developer about e-signature status) 

Decline it. 

Give a decline reason where desired. 

See when it expires. 

 

Acceptance stores: 

 

offer 

accepted/declined status 

applicant identity 

identity binding 

time and date 

source channel 

execution record 

 

The SOW distinguishes MVP in-platform acceptance from a later electronic-signature mechanism exposed through MyGuyana. Implement the approved project phase explicitly; do not silently claim that in-platform acceptance is a cryptographic e-signature. 

 

Possible internal transitions: 

 

Approved → Offer prepared 

Offer prepared → Accepted 

Offer prepared → Declined 

Offer prepared → Expired 

Accepted → Conditions being completed 

 

Citizen-facing wording should be clear, for example “Your offer is ready”, “You accepted this offer”, or “This offer has expired”, rather than exposing internal workflow codes. 

 

 

 

17. Conditions management 

Conditions are a complete business capability, not a single checkbox. 

 

17.1 Derivation 

When the offer is accepted, the system derives the pre-disbursement condition set from: 

 

decision 

product configuration 

application type 

sector 

training requirements 

verification results 

bank-account requirements 

approved policy 

 

The derived set must be retained with the relevant configuration/version context. If a condition is added or changed, the reason and actor must be recorded. 

 

Examples: 

 

Offer accepted 

Required evidence accepted 

Verified nominated account 

Training modules complete 

Applicant confirmation complete 

Bank countersignature complete where applicable 

Product-specific prerequisite complete 

 

17.2 Condition record 

Each condition should contain: 

 

condition ID 

facility/offer/application 

condition type 

description 

source requirement 

required/optional flag 

responsible party 

applicant action required 

staff verification required 

status 

submitted evidence/reference 

verified by 

verified timestamp 

rejection/rework reason 

expiry where applicable 

configuration version 

 

17.3 Condition lifecycle 

Use internal condition states such as: 

 

Required 

Submitted 

Under review 

Accepted 

Rejected — action needed 

Waived — authorized 

Expired 

Not applicable 

 

These are implementation states. The applicant should see plain labels: 

 

To complete 

Sent for review 

Accepted 

Please correct this item 

Not required 

 

Who sets the conditions 

Mostly the system, not the Underwriter. Conditions derive automatically on offer acceptance from product config + decision + sector + verification results. 

The Underwriter can add case-specific conditions at decision time. They cannot remove policy-derived ones. The DO can neither add nor waive — waiver needs named authority above them. 

The checks (indicative) 

Policy-derived (automatic) 

Offer accepted and executed 

Training modules complete — re-checked, not trusted from submission 

Nominated bank account verified 

Required evidence accepted 

Bank countersignature complete 

Applicant confirmation done 

Re-derived at the moment of release (the real gate) 

Approved amount still matches decision 

Verifications not expired 

Training hasn't regressed 

Authorisation matrix still valid 

Underwriter ≠ releasing officer 

Underwriter-added (case-specific examples) 

Supplier quotation for the funded asset 

Updated bank statement 

Lease or premises proof 

Co-owner consent 

Division of labour 

Underwriter authors exceptions. System authors policy. DO verifies everything and pulls the trigger — and the gate recomputes on click, not on page load. 

 

17.4 Applicant functions 

The applicant can: 

 

View all conditions. 

See which conditions require their action. 

See instructions and due dates. 

Upload supporting evidence. 

Replace rejected evidence where allowed. 

Confirm information. 

See whether an item is awaiting staff review. 

See why an item needs correction. 

See overall release readiness. 

 

17.5 Staff verification and release gate 

The Disbursement Officer must verify every required condition. Verification is attributed and timestamped. 

 

The system must prevent release if: 

 

any required condition is not accepted 

training is incomplete or has regressed 

bank account is not verified 

required execution/countersignature is incomplete 

required authorization is missing 

amount or entitlement no longer matches the decision 

 

At the point of release, the system re-derives entitlement and authorizations. The applicant cannot authorize release. No scheduled job or automated process may release funds. 

 

The Underwriter who made the decision cannot authorize disbursement. 

 

 

 

18. Disbursement and receipt 

After all conditions are accepted: 

 

Disbursement Officer reviews release readiness 

    ↓ 

Disbursement Officer explicitly authorizes release 

    ↓ 

System creates payment instruction 

    ↓ 

Bank of Guyana/approved bank integration receives instruction 

    ↓ 

Provider result is recorded 

    ↓ 

Successful disbursement creates immutable financial event 

    ↓ 

Applicant confirms receipt 

    ↓ 

Facility becomes active 

 

The platform does not collect funds directly. It instructs and records. 

 

Handle: 

 

successful payment 

failed payment 

returned payment 

partial payment 

unknown/pending provider result 

manual exception resolution 

 

Every exception requires an explicit attributed action. A notification or retry must not create a second disbursement. 

 

 

 

19. Loan facility, repayment schedule and ledger 

After successful disbursement, create or activate the loan facility using the authorized offer and terms. 

 

Facility information 

The borrower can see: 

 

Facility reference. 

Product. 

Authorized amount. 

Disbursed amount. 

Zero-interest terms. 

Term. 

Schedule. 

Next instalment. 

Current derived balance. 

Payment history. 

Amounts due. 

Days past due where applicable. 

Facility status. 

Executed offer. 

Statements. 

 

Schedule 

Generate the repayment schedule from authorized terms. There is no interest component. 

 

Retain schedule versions when restructuring occurs. A new schedule must not erase the prior schedule. 

 

Ledger 

The loan ledger is append-only: 

 

Never update a ledger entry. 

Never delete a ledger entry. 

Record a correction/reversal as a new linked entry. 

Allocate receipts using configured allocation rules. 

Use the same ledger fold for borrower dashboard, statements, Finance reports and tax-facing reports. 

Derive balance and arrears at read time. 

Do not treat editable balance, overdue flag or ageing bucket fields as the source of truth. 

 

 

 

20. Borrower statements and facility closure 

The borrower can request a statement for any period. 

 

The statement contains, as applicable: 

 

facility 

period 

opening derived position 

instalments due 

payments received 

allocations 

adjustments/reversals 

closing derived position 

statement generated time 

as-at time 

 

When fully repaid: 

 

Active → Fully repaid → Closed 

 

The borrower retains access to: 

 

Final statement. 

All payment history. 

Executed offer. 

Schedule versions. 

Facility history. 

 

Closing a facility does not delete any record. 

 

 

 

21. Customer-facing language versus internal states 

Internal states are necessary for workflow, but they should not be displayed as raw database values. 

 

Internal concept 

Applicant-facing wording 

Draft 

Not submitted yet 

Submitted 

Application sent 

Under review 

GDB is reviewing your application 

Information requested 

We need more information from you 

Verification unavailable 

One check is not available yet 

Declined 

Your application was not approved 

Offer generated 

Your offer is ready 

Accepted 

You accepted the offer 

Conditions pending 

Complete these items before funds can be released 

Disbursement pending 

Payment is being arranged 

Active facility 

Your loan is active 

Overdue 

A payment is past its due date 

Closed 

This facility is fully repaid 

The applicant must always see the next action where one exists. 

 

 

 

22. Applicant screens and layout behavior 

Main applicant screens 

Public programme information 

Sign in / identity return 

Consent 

Start or continue application 

Choose individual or cluster route 

Choose existing business or new venture 

About you 

Your business or venture 

Market and customers 

Operations 

Team 

Financial information or projections 

Funding request 

Documents 

Training 

Review and submit 

Application sent 

Application progress 

Information requested 

Decision result 

Letter of Offer 

Conditions before release 

Disbursement result 

Borrower facility 

Repayment schedule 

Payment history 

Statement request/download 

 

Design direction 

Use a formal civic “ledger” language rather than a generic fintech dashboard: 

 

Paper-like page ground. 

Ruled lines as the main structure. 

Blue for primary action/state. 

Gold only for verified agency stamps or executed instruments. 

Sentence-case labels. 

Clear money column with right-aligned tabular figures. 

Every important number has its derivation nearby. 

Legal Letter of Offer uses a formal document treatment. 

Mobile and low-bandwidth behavior is a first-class requirement. 

 

The layout must not hide conditions, derivations, missing evidence or next actions behind decorative UI. 

 

Responsive layout 

1440px+   content column plus fixed right money gutter 

1024px    content plus money gutter 

768px     narrower money gutter; horizontal progress navigation may scroll 

<768px    amount moves below its label but remains right-aligned; steps become a select/list 

 

Use sticky action areas on long forms: 

 

one clear blocker or missing requirement 

one primary next action 

 

Do not show an enabled Submit button when submission is impossible. Explain the blocker. 

 

 

 

23. Frontend responsibilities 

The React frontend is responsible for: 

 

Rendering the correct applicant screens. 

Showing the correct route based on application type and cluster choice. 

Saving sections and showing save state. 

Showing evidence upload progress and errors. 

Showing training completion. 

Showing customer-safe status and next action. 

Rendering the authoritative offer returned by the backend. 

Showing conditions and applicant action requirements. 

Showing schedules, payments and statements. 

Supporting low-bandwidth behavior and appropriate offline field behavior where applicable. 

Showing loading, empty, error, retry and session-expired states. 

Providing keyboard-accessible forms and clear focus on validation errors. 

 

The frontend is not responsible for deciding: 

 

whether an applicant is authorized 

whether a document is sufficient 

whether a check passes 

whether an amount is approved 

whether conditions are satisfied 

whether money may be released 

whether a ledger entry is valid 

 

The backend is authoritative for all of these. 

 

 

 

24. Applicant API actions 

Use custom Frappe whitelisted actions for important operations: 

 

identity.api.get_current_person 

identity.api.record_consent 

clusters.api.create_cluster 

clusters.api.invite_member 

clusters.api.request_facilitator_support 

training.api.get_my_requirements 

training.api.get_my_completion 

origination.api.create_application 

origination.api.select_application_route 

origination.api.save_application_section 

origination.api.get_application_progress 

origination.api.submit_application 

origination.api.withdraw_application 

evidence.api.upload_evidence 

evidence.api.replace_evidence 

evidence.api.get_my_evidence 

origination.api.get_my_requests 

origination.api.respond_to_information_request 

underwriting.api.get_my_decision_result 

underwriting.api.get_my_offer 

underwriting.api.accept_offer 

underwriting.api.decline_offer 

money.api.get_my_conditions 

money.api.submit_condition_item 

money.api.confirm_receipt 

servicing.api.get_my_facilities 

servicing.api.get_my_schedule 

servicing.api.get_my_payment_history 

servicing.api.get_my_statement 

 

Use Resource API only for safe, permission-filtered reads that return customer-safe fields. Do not allow generic CRUD mutation of decisions, offers, disbursements, receipts or ledger entries. 

 

 

 

25. Data privacy and authorization 

An applicant may read and act only on their own permitted person, application, evidence, offer, conditions, facility, payments and statements. 

 

The applicant must never receive: 

 

internal assessment scores 

internal risk ratings 

confidential compliance results 

sanctions/PEP details 

underwriting notes 

specialist private notes 

staff assignment or queue data 

other cluster member financial information 

other applicant data 

Finance internal portfolio data 

 

Enforce this at the Frappe API and database permission boundary. Hiding a React button is not security. 

 

 

 

26. Error, retry and idempotency requirements 

Every important action must be safe under retry: 

 

Double-clicking Submit cannot create two submissions. 

Repeating an upload cannot create uncontrolled duplicate evidence. 

Repeating offer acceptance cannot create multiple execution records. 

Repeating a bank callback cannot create a duplicate disbursement. 

Repeating a repayment callback cannot create a duplicate receipt. 

Re-running a check retains the prior result. 

Retrying an unavailable integration does not convert it to Pass. 

A failed save must tell the applicant whether the data was saved. 

 

Use stable request IDs or idempotency keys for operations that create financial, execution or state-change records. 

 

 

 

27. Audit requirements 

Audit at least: 

 

identity linked 

consent accepted 

application created 

route selected 

section saved 

cluster created/joined 

member invited 

training synchronized 

training gate evaluated 

evidence uploaded 

evidence replaced 

application submitted 

information requested 

information supplied 

verification requested 

verification rerun 

decision recorded 

offer generated 

offer accepted/declined/expired 

condition derived 

condition submitted 

condition verified/rejected 

release authorized 

disbursement instructed 

disbursement outcome recorded 

receipt recorded/reversed 

statement generated 

facility closed 

 

Each event stores actor, actor type, action, target, time, basis/reason, source channel and human/system origin. Audit history is readable but not editable through normal application APIs. 

 

 

 

28. Implementation ownership 

identity          identity assertion, person record and consent 

programme         products, ceilings, terms, sectors and prerequisites 

clusters          cluster membership and shared plan 

training          curriculum requirements and completion 

origination       application routes, sections, progress, submission and withdrawal 

evidence          documents, classification, provenance, review and versions 

field_operations  assisted capture, site visits, offline sync and monitoring 

underwriting      checks, assessment, queue, human decision, offer and execution 

money             conditions, release, payment instruction, receipts and reconciliation 

servicing         facility, schedule, ledger, allocation, statements and closure 

governance        audit, exports, reports and integration health 

 

If another capability needs an operation, it calls the owning capability's service. It must not implement a second copy. 

 

 

 

29. Acceptance criteria for the applicant journey 

The implementation is not complete until an applicant can: 

 

Understand the product and terms. 

Authenticate and be represented by one permanent person record. 

Provide versioned consent. 

Apply alone or through a cluster route. 

Choose existing business or new venture. 

Complete the correct route-specific form. 

Provide business details, market, customers, operations, team and financial/projection data. 

Save and resume every section. 

Upload classified, versioned evidence. 

Complete training independently. 

See every missing requirement. 

Submit only when the required gates pass. 

Track a customer-safe application journey. 

Respond to a specific information request. 

Understand whether an issue is missing evidence, failed verification or unavailable information. 

Receive a customer-safe human decision result. 

Read the authoritative offer. 

Accept or decline it with retained identity binding. 

See conditions derived from the decision and product. 

Complete applicant-side conditions. 

See staff verification progress. 

Receive funds only after explicit authorized release. 

Confirm receipt. 

View an accurate zero-interest schedule. 

View derived balance and payment history. 

Request statements. 

See overdue information correctly when applicable. 

Retain all records after facility closure. 

 

The implementation is incorrect if it: 

 

Treats the journey as one generic form. 

Omits the existing-business/new-venture branch. 

Omits business details, target market, customers, operations, team or financials. 

Treats cluster membership as joint liability. 

Lets one cluster member complete another member's training. 

Uses one vague status for missing evidence, failed check and unavailable check. 

Exposes internal assessment or compliance information. 

Allows an automated credit decision. 

Allows generic CRUD to mutate a decision, offer, receipt or ledger. 

Allows release without conditions. 

Allows the deciding Underwriter to release money. 

Generates an offer with terms re-entered manually. 

Uses different calculations for balance, statements and reports. 

Edits or deletes ledger history. 

Creates duplicate receipts or disbursements after retries. 

Hard-codes product policy values. 

Treats a failed or unavailable integration as a successful pass. 

 

 

 

30. Claude Code instruction 

Implement the applicant journey as a real lending workflow. Do not reduce it to dashboard pages, placeholder forms or generic CRUD. 

 

Before coding any applicant feature: 

 

Identify the journey stage. 

Identify whether the applicant is individual, cluster-supported, existing-business or new-venture. 

Identify the owning backend capability. 

Identify the required business records and evidence. 

Identify the backend action/API. 

Identify the applicant-facing screen and next action. 

Identify permission, audit, retry and failure behavior. 

Search existing code before creating new code. 

Reuse the owning service instead of duplicating a workflow. 

 

After coding: 

 

Test the happy path. 

Test incomplete application behavior. 

Test missing evidence. 

Test failed and unavailable checks separately. 

Test individual and cluster routes. 

Test existing-business and new-venture routes. 

Test offer expiry and acceptance. 

Test incomplete and rejected conditions. 

Test separation of duties at release. 

Test duplicate submission and payment callbacks. 

Test applicant data isolation. 

Test schedule, ledger and statement consistency. 

 