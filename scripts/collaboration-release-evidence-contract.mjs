/**
 * Canonical names shared by evidence validators and GitHub release wiring.
 * Keep this module free of filesystem and network side effects so contract
 * tests can execute in a clean checkout before any runner is provisioned.
 */

export const RELEASE_EVIDENCE_TYPES = Object.freeze([
  Object.freeze({
    id: 'gateway',
    key: 'GATEWAY',
    workflowPath: '.github/workflows/collaboration-gateway-release-evidence.yml',
    artifactName: 'collaboration-gateway-release-evidence',
    evidenceFile: 'collaboration-gateway-release-evidence.json',
  }),
  Object.freeze({
    id: 'visual',
    key: 'VISUAL',
    workflowPath: '.github/workflows/collaboration-visual-release-evidence.yml',
    artifactName: 'collaboration-visual-release-evidence',
    evidenceFile: 'collaboration-visual-release-evidence.json',
  }),
  Object.freeze({
    id: 'soak',
    key: 'SOAK',
    workflowPath: '.github/workflows/collaboration-soak-release-evidence.yml',
    artifactName: 'collaboration-soak-release-evidence',
    evidenceFile: 'collaboration-soak-release-evidence.json',
  }),
]);

export const TRUSTED_EVIDENCE_WORKFLOWS = Object.freeze(
  Object.fromEntries(RELEASE_EVIDENCE_TYPES.map(({ key, workflowPath }) => [key, workflowPath])),
);

export const RELEASE_EVIDENCE_BY_ID = Object.freeze(
  Object.fromEntries(RELEASE_EVIDENCE_TYPES.map((entry) => [entry.id, entry])),
);

export function requireReleaseEvidenceType(id) {
  const contract = RELEASE_EVIDENCE_BY_ID[id];
  if (!contract) throw new Error(`Unknown release evidence type: ${id}`);
  return contract;
}
