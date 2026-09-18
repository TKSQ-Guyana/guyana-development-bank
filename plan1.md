C1 — Channel and access 

F1.1  Program information 

ID 

Requirement 

Ph 

R-001 

Present program terms — G$3,000,000 maximum, 0% interest, no collateral — sourced from configuration 

1 

R-002 

Explain eligible sectors including an "other — value creation" route so an unlisted sector is not turned away 

1 

R-003 

Explain priority groups (youth and women entrepreneurs) and what priority means in practice 

1 

R-004 

Publish a readiness checklist of documents and prerequisites 

1 

R-005 

Pages must render usably on a low-bandwidth mobile connection 

1 

F1.2  Registration and identity 

ID 

Requirement 

Ph 

R-008 

Consume a verified identity assertion from MyGuyana; the lending platform performs no identity verification of its own 

1 

R-009 

Store the permanent identifier (GUIN/RIDN) as the person key 

1 

R-010 

Never use a card Document Number or Card Access Number as an identifier 

1 

R-011 

Support national-ID based registration where no e-ID exists, flagged for later upgrade 

1 

R-012 

Capture explicit consent for registry and credit checks at registration, with the consent text versioned and retained 

1 

R-013 

Prevent duplicate person records for the same permanent identifier 

1 

R-014 

Support agent-assisted registration by a field officer, recording who performed it 

1 

 

C2 — Applicant capabilities 

F2.1  Guided application 

ID 

Requirement 

Ph 

R-015 

Branch the application by type — existing business or new venture — and present only relevant sections 

1 

R-016 

Capture existing-business financials: revenue, costs, obligations, monthly cash position 

1 

R-017 

Capture new-venture and existing-business plan sections: vision, mission, goals, customer segments, target market and ecosystem, operations, team, strategy 

1 

R-018 

Capture requested amount and purpose of funds 

1 

R-019 

Capture sector and, where applicable, sub-sector 

1 

R-020 

Capture priority-group declaration independently of sector 

1 

R-021 

Save each section on completion; allow resuming the application without data loss 

1 

R-022 

Show progress and what remains outstanding at all times 

1 

R-023 

Ask any user information once and reuse it across the application 

1 

R-024 

Limit a loan amount request that is above the ceiling amount with a plain explanation 

1 

R-025 

Prevent submission until required sections and evidence are present 

1 

R-026 

Support withdrawal of an application by the applicant before decision 

1 

 

F2.2  Evidence management 

ID 

Requirement 

Ph 

R-027 

Accept document upload with type classification  

(financials, plan, identity, proof of address, other) 

1 

R-028 

Support proof of address as an explicit evidence type 

1 

R-029 

Show a document shelf with the status of each item 

1 

R-030 

Enforce file type and size limits with clear error messaging 

1 

R-031 

Record the provenance of every document — who supplied it and by what route 

1 

R-032 

Distinguish applicant-supplied evidence from field-officer-captured evidence in the record 

2 

R-033 

Allow replacement of a document during the application process 

1 

 

F2.3  Application tracking 

ID 

Requirement 

Ph 

R-034 

Show current status in plain language, with what happens next 

1 

R-035 

Present an information request as an itemized, actionable list 

1 

R-036 

Notify the applicant on status change via configured channels 

1 

R-037 

Never expose internal assessment scores, compliance results or underwriting notes to the applicant 

1 

 

F2.4  Offer and acceptance 

ID 

Requirement 

Ph 

R-038 

Generate the Letter of Offer from the recorded decision, with no re-entry of terms 

1 

R-039 

Use one authoritative offer document for both staff and applicant views 

1 

R-040 

Present the offer with amount, term, schedule and conditions in plain language 

1 

R-041 

Capture the applicant's in-platform acceptance of the offer with timestamp and identity binding, retained as the execution record 

1 

R-042 

Capture bank countersignature in platform; the retained execution record constitutes the agreement 

1 

R-043 

Support decline of an offer and record the reason where given 

1 

R-044 

Expire an offer after its validity period and record the lapse 

1 

R-045 

Make the executed record downloadable by the borrower for the life of the facility 

1 

 

F2.5  Borrower self-service 

ID 

Requirement 

Ph 

R-046 

Show current balance, next instalment and schedule, all derived from the account ledger 

1 

R-047 

Record a repayment and reflect it immediately in derived figures 

1 

R-048 

Generate a statement for any period on demand 

1 

R-049 

Show payment history across all facilities held by the borrower 

1 

 

C3 — Field and regional capabilities 

F3.1  Sourcing and agent-assisted origination 

ID 

Requirement 

Ph 

R-050 

Allow a field officer to create a lead and convert it to a registered applicant 

1 

R-051 

Allow a field officer to complete an application on an applicant's behalf, with the applicant's recorded consent 

1 

R-052 

Attribute every agent-captured entry to the officer who made it 

1 

R-053 

Bound a field officer's visibility to their assigned region and cases only 

1 

 

F3.2  On-site verification 

ID 

Requirement 

Ph 

R-054 

Record a structured site visit: date, location, observations, photographic evidence 

1 

R-055 

Attach visit records to the case as evidence via file upload, marked as officer-observed 

1 

R-056 

Prevent a field officer from altering an applicant's own declared answers 

1 

 

ID 

Requirement 

Ph 

R-063 

Create a cluster with a name, region, sector and an owning cluster head; a facilitator may be assigned to the cluster 

1 

R-064 

Add members by identifier lookup, and invite members not yet registered 

1 

R-065 

Maintain member status (invited, active, exited) with dates 

1 

R-066 

Never expose one member's financial data to another member 

1 

R-067 

Ensure member exit does not invalidate any other member's application or facility 

1 

R-068 

Allow an applicant to create a cluster and invite members to it 

1 

R-069 

Allow an applicant to request facilitator support for their application, routed to a facilitator in the applicant's region 

1 

 

F4.2  Shared planning 

ID 

Requirement 

Ph 

R-070 

Provide a shared cluster plan with clearly separated shared and member-specific sections 

1 

R-071 

Allow the cluster head / facilitator to edit shared sections; restrict member sections to their owner 

1 

R-072 

Ensure plan changes never alter an application, assessment, decision or offer 

1 

 

F4.3  Training via Coursera 

ID 

Requirement 

Ph 

R-073 

Configure which Coursera modules are required per sector and per product 

1 

R-074 

Record enrolment and module completion per applicant from the Coursera API; applicants complete modules directly in Coursera 

1 

R-075 

Surface training completion on the applicant and borrower profile as a gating condition, module by module with completion dates 

1 

R-076 

Report training reach by region, sector and priority group 

2 

R-077 

Signpost external government support programs with provenance and last-verified date 

1 

R-078 

Manage the training curriculum through the Coursera API; curriculum content is authored, hosted, and approved by the Ministry 

1 

R-079 

Record enrolment and completion per member and expose completion as a gating condition for application submission and loan disbursement 

1 

C5 — Verification and assessment 

C5.0  General 

ID 

Requirement 

Ph 

R-080 

Consume the verified identity assertion from My Guyana; the platform performs no direct national identity registry integration 

1 

R-081 

Verify business registration status against the business registry 

1 

R-082 

Consume tax compliance status from My Guyana (GRA) 

1 

R-083 

Verify social insurance compliance status 

1 

R-084 

Retrieve credit history and repayment track record 

1 

R-085 

Screen against sanctions/PEP and adverse media 

1 

R-086 

Verify the nominated bank account for disbursement 

1 

R-087 

Extend checks to directors and beneficial owners, not the business alone 

1 

R-088 

Record each check with source, timestamp, result and reference 

1 

R-089 

Record an unavailable check as *unavailable*, never as a pass 

1 

R-090 

Never block an application from proceeding to human review because a check is unavailable 

1 

R-091 

Re-run a check on demand and retain the prior result 

1 

 

F5.5  Structured assessment 

ID 

Requirement 

Ph 

R-092 

Produce a repayment-capacity assessment for existing businesses from evidenced financials 

1 

R-093 

Produce a plan-readiness assessment for new ventures across the required plan dimensions 

1 

R-094 

Rank evidenced figures above self-declared figures wherever both exist 

1 

R-095 

Record which inputs the assessment consumed, and invalidate the assessment when they change 

1 

R-096 

Never present an assessment as a decision or a recommendation to approve 

1 

R-097 

Apply the configured ceiling and any group-derived context at assessment time 

1 

 

F5.6  Sector benchmarking 

ID 

Requirement 

Ph 

R-098 

Allow a sector specialist to maintain sector reference data (cost norms, seasonality, typical margins) 

1 

R-099 

Surface relevant sector context in the underwriting workspace, attributed to its author and date 

1 

C6 — Credit decisioning 

F6.1  Queue and assignment 

ID 

Requirement 

Ph 

R-100 

Place every submitted application in the underwriting queue — no application bypasses it 

1 

R-101 

Assign cases to underwriters by configurable rules (region, sector, workload) 

1 

R-102 

Group the queue by working state (new, in review, awaiting information, referred) 

1 

R-103 

Prevent an underwriter from acting on a case assigned to another underwriter 

1 

R-104 

Show queue age and time-in-state to support service standards 

1 

 

F6.2  Case workspace 

ID 

Requirement 

Ph 

R-105 

Present application, evidence, verification results and assessment in one workspace 

1 

R-106 

Organize the case by review stage: completeness, identity and business, capacity, credit and compliance, policy fit, outcome 

1 

R-107 

Link every displayed fact to its source document 

1 

R-108 

Allow the underwriter to record stage-level observations 

1 

R-109 

Show group/cluster context where applicable, without other members' financial data 

1 

 

F6.3  Decision 

ID 

Requirement 

Ph 

R-110 

Support four outcomes: approve, decline, refer, request information 

1 

R-111 

Require a recorded rationale for every outcome 

1 

R-112 

Require an approved amount on approval, validated against the GDB program ceiling and assessed capacity 

1 

R-113 

Record the deciding underwriter, timestamp and the evidence state at decision time 

1 

R-114 

Prevent any automated or system-originated decision under all conditions, including AI failure 

1 

R-115 

Make a recorded decision immutable; corrections are new, linked, and explained events 

1 

R-116 

Support an approval authority matrix by amount band if GDB policy requires one 

1 

R-117 

Apply an electronic signature to the Letter of Offer using the mechanism exposed through My Guyana, and retain the executed instrument 

1 

 

F6.4  Specialist input 

ID 

Requirement 

Ph 

R-118 

Allow a sector specialist to add attributed technical input to a case 

1 

R-119 

Present specialist input to the underwriter as advice, never as an outcome 

1 

R-120 

Deny specialist access to decision controls 

1 

 

C7 — Money movement 

F7.1  Conditions 

ID 

Requirement 

Ph 

R-121 

Derive the pre-disbursement conditions set from the decision and product configuration 

1 

R-122 

Present conditions to the applicant and disbursement officer as an actionable checklist 

1 

R-123 

Require staff verification of each condition, attributed and timestamped 

1 

R-124 

Prevent release while any condition is unverified 

1 

R-125 

Re-derive entitlement and required authorizations at the point of release 

1 

R-126 

Refuse release and state the reason if any precondition cannot be verified 

1 

R-127 

Require the Disbursement Officer to authorize release explicitly; no scheduled or automatic release 

1 

R-128 

Issue the payment instruction to the nominated verified account only 

1 

R-129 

Record the disbursement as an immutable ledger event with instruction reference 

1 

R-130 

Capture borrower confirmation of receipt 

1 

R-131 

Enforce separation of duties: the deciding underwriter cannot authorize the release 

1 

R-132 

Re-verify training completion at the pre-disbursement check, module by module with completion dates; hold release where the record is incomplete or has regressed since the credit decision, without reopening the decision 

1 

 

F7.4  Reconciliation and exceptions 

ID 

Requirement 

Ph 

R-133 

Reconcile each disbursement against the offered amount to the cent 

1 

R-134 

Surface any failed, returned or partial payment in an exception queue 

1 

R-135 

Require explicit, attributed action to resolve any exception 

1 

R-136 

Provide a daily disbursement reconciliation report 

1 

F7.5  Repayment recording and visibility 

ID 

Requirement 

Ph 

R-137 

Record repayments from every supported channel into the single loan ledger 

1 

R-138 

Allocate a receipt to the schedule per configured allocation rules 

1 

R-139 

Support reversal of a mis-posted receipt as a new, linked, explained entry 

1 

R-140 

Record repayments made through Republic Bank, Demerara Bank and Bank of Guyana; the platform does not collect funds 

1 

R-141 

Issue a manual payment invoice to the borrower carrying a payment reference 

1 

R-142 

Track a manual payment from issue to settlement and surface its status to the borrower 

1 

 

C8 — Servicing 

C8.0  General 

ID 

Requirement 

Ph 

R-143 

Maintain an append-only loan ledger; never update or delete an entry 

1 

R-144 

Derive every balance, arrears figure and statement by reading the ledger at read time 

1 

R-145 

Store no balance, no overdue flag and no ageing bucket 

1 

R-146 

Generate the repayment schedule from the authorized terms, with no interest component 

1 

R-147 

Compute days past due at query time as the age of the oldest unpaid instalment 

1 

R-148 

Generate borrower statements and any tax-facing report from the same ledger fold as all other figures 

1 

R-149 

Support authorized restructuring, regenerating the schedule and retaining the prior one 

1 

R-150 

Record facility closure on full repayment, retaining the full history 

1 

 

C9 — Product, portfolio and governance 

F9.1  Configuration 

ID 

Requirement 

Ph 

R-151 

Hold the per-borrower ceiling, sector list, priority groups, term bounds and prerequisites as configuration 

1 

R-152 

Derive every displayed policy figure from that configuration 

1 

R-153 

Fail the build if any policy figure is hard-coded in application code or content 

1 

R-154 

Version every configuration change with author, timestamp and effective date 

1 

R-155 

Restrict configuration write access to the Finance Department 

1 

R-156 

Report total disbursed, active facilities, principal outstanding, amounts due and collected, and collection efficiency 

2 

R-157 

Report ageing across defined past-due bands, excluding not-yet-due amounts from overdue totals 

2 

R-158 

Guarantee that unfiltered table totals equal headline figures to the cent, proven by automated test 

2 

R-159 

Filter and report by date range, sector, region, priority group and amount band 

2 

R-160 

Export the filtered set with the active filter criteria written into the file 

2 

R-161 

Log every export with user, timestamp, filters and row count 

2 

R-162 

Show an "as at" timestamp on every financial view 

2 

R-163 

Refuse any non-read request from a read-only oversight role 

2 

 

F9.5  Governance reporting 

ID 

Requirement 

Ph 

R-164 

Report capital deployed against allocated capital 

2 

R-165 

Report program reach by sector, region and priority group 

2 

R-166 

Report portfolio health at aggregate level only 

2 

R-167 

Exclude all individual case, credit, compliance and identity detail from governance views 

2 

R-168 

Support a periodic board reporting pack export 

2 

 

C10 — Common and platform 

C10.0  General 

ID 

Requirement 

Ph 

R-169 

Separate applicant and staff authentication contexts so both can be active independently 

1 

R-170 

Enforce all authorization server-side at the API boundary 

1 

R-171 

Scope staff access by role and, where applicable, by region and sector 

1 

R-172 

Keep applicant-facing and staff API surfaces disjoint; return only customer-safe fields to applicants 

1 

R-173 

Record an audit event for every state change: actor, action, target, timestamp, basis 

1 

R-174 

Distinguish system-originated actions from human actions in the audit record 

1 

R-175 

Make the audit trail readable but never editable, including by administrators 

1 

R-176 

Send email and SMS only where credentials are configured; never record a send that did not occur 

1 

R-177 

Store documents access-controlled, encrypted at rest, with retention metadata 

1 

R-178 

Place each external system behind a single adapter with health, timeout, retry and explicit unavailability 

1 

R-179 

Provide a sandbox mode per integration for testing without live external calls 

1 

R-180 

Provision, scope, suspend and deactivate any user account 

1 

R-181 

Deny the Platform Admin role any access to case evidence, credit decisions or money movement 

1 

R-182 

Surface integration health and failure rates to the Platform Admin 

1 

R-183 

Retain and purge personal data per a configured retention policy, with the purge auditable 

2 

R-184 

Meet accessibility standards: semantic markup, keyboard operation, 4.5:1 minimum contrast 

1 

R-185 

Present all monetary values in GYD with consistent formatting and no false precision 

1 

 

CA — AI services 

FA.1  Governing rules and capability requirements 

ID 

Requirement 

Ph 

R-186 

No AI component records, makes or influences a credit decision without a named human approving it 

2 

R-187 

Route every AI failure or unavailability to a named person, never to an automatic outcome 

2 

R-188 

Run model inference inside the agreed data residency boundary 

2 

R-189 

Cite the evidence behind every AI-produced summary or analysis 

2 

 

FA.2  AI-1 — Information and navigation 

ID 

Requirement 

Ph 

R-190 

Answer applicant questions on program terms, eligibility, sectors and priority groups from configuration, never from memorized content 

2 

R-191 

Guide the applicant to the next required step and explain what is outstanding 

2 

R-192 

State plainly that guidance is not an application, an assessment or a decision 

2 

 

FA.3  AI-2 — Underwriting assistant 

ID 

Requirement 

Ph 

R-193 

Produce a case summary for the underwriter drawn only from submitted evidence and verification results 

2 

R-194 

Cite the source document and field behind every statement in the summary 

2 

R-195 

Surface gaps, inconsistencies and unverified claims without proposing an outcome 

2 

R-196 

Never pre-populate, suggest or default the decision field 

2 

FA.4  AI-3 — Financial and document analysis 

ID 

Requirement 

Ph 

R-197 

Extract figures from submitted financial statements and bank records and present them against the declared position 

2 

R-198 

Rank each input by evidence quality: verified, documented, or self-declared 

2 

R-199 

Flag any figure it could not extract with confidence rather than estimating it 

2 

 

FA.5  AI-4 — Business planning guidance 

ID 

Requirement 

Ph 

R-200 

Help an applicant structure a business plan covering vision, customers, operations, team and financial projections 

2 

R-201 

Offer sector context drawn from the maintained benchmark set, with the benchmark source and vintage shown 

2 

R-202 

Never assert that following the guidance improves the likelihood of approval 

2 

 

CI — Identity and access 

FI.1  Identity and access requirements 

ID 

Requirement 

Ph 

R-203 

Resolve the identity assertion consumed from My Guyana to the permanent identifier (GUIN or RIDN) 

1 

R-204 

Accept national-ID registration where no e-ID exists, flagged for upgrade 

1 

R-205 

Upgrade an existing national-ID account to e-ID verification without creating a duplicate person 

2 

R-206 

Never key a person record on a Document Number or CAN 

1 

R-207 

Design identity as an adapter, so federated sign-in can be added without data model change 

1 

R-208 

Capture, version and retain the consent under which each external check is performed 

1 

R-209 

Never transmit credit, compliance or underwriting content to any external portal or service 

1 

R-210 

Support in-person assisted identity capture at a field or service-center setting 

1 

R-211 

Enforce session separation between applicant and staff contexts 

1 

R-212 

Apply least-privilege scoping — role, region, sector, and case assignment — at the API boundary 

1 

 