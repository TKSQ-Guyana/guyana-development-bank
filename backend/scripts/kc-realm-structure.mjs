// THE REALM STRUCTURE THIS BUILD REQUIRES — one module, two consumers.
//
// A Keycloak realm imported before a feature shipped simply does not have the
// realm roles or agency groups that feature needs (mpsdev was missing
// MPS_Agency_Minister on 2026-09-05, and every deployed realm started with
// only 4 of the 38 agency groups — one under a stale id). This module is the
// single statement of what must exist, read by:
//
//   * backend/scripts/kc-ensure-realm.mjs — the DEPLOY gate: runs in the
//     backend container's entrypoint after the DB migrations, as the
//     mps-provisioning-service service account, and creates whatever is
//     missing. Structure ONLY.
//   * keycloak-local/setup-mps.mjs — the DEV seeder: everything here PLUS the
//     test accounts, passwords and local web origins that must never reach a
//     deployed realm.
//
// STRUCTURE MEANS: realm roles and agency groups. Never users, never
// credentials, never client configuration — those stay where they are
// (provisioning screen, dev seeder, console).
//
// The agency ids and names are EXACTLY as mps.agencies spells them (the real
// establishment register, migrations 0009/0016): the group's agency_id
// attribute is what the token carries, and every per-agency grant, IAP lookup
// and request filing keys on it. A group named for an agency the register
// does not hold produces an originator whose requests file under a phantom
// agency (the old AG-MOA, where the register says AG-MOAG).

/** Realm roles newer than the shipped realm export, with their descriptions. */
export const REQUIRED_REALM_ROLES = [
  {
    name: 'MPS_Agency_Minister',
    description:
      'MPS Workforce Portal - Minister of the originating agency/ministry/region. ' +
      'Pre-MPS review of the agency’s own requests: Acknowledged, or Objection ' +
      'with mandatory comment; agency-scoped by /MPS-Agencies group. NOT MPS staff.',
  },
]

/** The group every agency lives under; its children carry the agency claims. */
export const AGENCY_GROUP_PARENT = 'MPS-Agencies'

/** The full establishment register — every row of mps.agencies. */
export const AGENCIES = [
  { id: 'AG-DEPTX', name: 'Ministry of Public Works' },
  { id: 'AG-DPP', name: 'Director of Public Prosecutions' },
  { id: 'AG-MOAA', name: 'Ministry of Amerindian Affairs' },
  { id: 'AG-MOAG', name: 'Ministry of Agriculture' },
  { id: 'AG-MOCYS', name: 'Ministry of Culture Youth & Sport' },
  { id: 'AG-MOE', name: 'Ministry of Education' },
  { id: 'AG-MOF', name: 'Ministry of Finance' },
  { id: 'AG-MOFA', name: 'Ministry of Foreign Affairs' },
  { id: 'AG-MOH', name: 'Ministry of Health' },
  { id: 'AG-MOHA', name: 'Ministry of Home Affairs' },
  { id: 'AG-MOHSSS', name: 'Ministry of Human Services & Social Security' },
  { id: 'AG-MOHWA', name: 'Ministry of Housing & Water' },
  { id: 'AG-MOLA', name: 'Ministry of Legal Affairs' },
  { id: 'AG-MOLAB', name: 'Ministry of Labour' },
  { id: 'AG-MOLGRD', name: 'Ministry of Local Government & Regional Development' },
  { id: 'AG-MONR', name: 'Ministry of Natural Resources' },
  { id: 'AG-MOPAG', name: 'Ministry of Parliamentary Affairs and Governance' },
  { id: 'AG-MOPUA', name: 'Ministry of Public Utilities and Aviation' },
  { id: 'AG-MOTIC', name: 'Ministry of Tourism, Industry & Commerce' },
  { id: 'AG-MPSGEI', name: 'Ministry of Public Service, Government Efficiency & Implementation' },
  { id: 'AG-OMB', name: 'Ombudsman Office' },
  { id: 'AG-OPM', name: 'Office of the Prime Minister' },
  { id: 'AG-OTP', name: 'Office of the President' },
  { id: 'AG-PARL', name: 'Parliament Office' },
  { id: 'AG-PSAT', name: 'Public Services Appellate Tribunal' },
  { id: 'AG-PSC', name: 'Public Service Commission' },
  { id: 'AG-REG1', name: 'Barima / Waini (Region No. 1)' },
  { id: 'AG-REG2', name: 'Pomeroon/ Supenaam (Region No. 2)' },
  { id: 'AG-REG3', name: 'Essequibo Islands /West Demerara (Region No. 3)' },
  { id: 'AG-REG4', name: 'Demerara/ Mahaica (Region No. 4)' },
  { id: 'AG-REG5', name: 'Mahaica/ Berbice (Region No. 5)' },
  { id: 'AG-REG6', name: 'East Berbice /Corentyne (Region No. 6)' },
  { id: 'AG-REG7', name: 'Cuyuni/ Mazaruni (Region No. 7)' },
  { id: 'AG-REG8', name: 'Potaro / Siparuni (Region No. 8)' },
  { id: 'AG-REG9', name: 'Upper Takatu /Upper Essequibo (Region No. 9)' },
  { id: 'AG-REG10', name: 'Upper Demerara/ Berbice (Region No. 10)' },
  { id: 'AG-SCOJ', name: 'Supreme Court' },
  { id: 'AG-TSC', name: 'Teaching Service Commission' },
]
