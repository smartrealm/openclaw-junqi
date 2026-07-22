import assert from 'node:assert/strict';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  RELEASE_EVIDENCE_TYPES,
  TRUSTED_EVIDENCE_WORKFLOWS,
} from './collaboration-release-evidence-contract.mjs';
import { WORKFLOW_ACTION_PINS } from './workflow-action-pins.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const RELEASE_WORKFLOW = path.join(REPOSITORY_ROOT, '.github/workflows/release.yml');
const RELEASE_ASSET_VERIFIER = path.join(REPOSITORY_ROOT, 'scripts/verify-github-release-assets.mjs');
const RELEASE_SOURCE_POLICY = path.join(REPOSITORY_ROOT, 'scripts/release-source-policy.mjs');
const RELEASE_PUBLICATION_STAGER = path.join(REPOSITORY_ROOT, 'scripts/stage-release-publication.mjs');
const RELEASE_INSPECTOR = path.join(REPOSITORY_ROOT, 'scripts/inspect-github-release.mjs');
const RELEASE_MUTATION_ADAPTER = path.join(REPOSITORY_ROOT, 'scripts/mutate-github-release.mjs');
const RELEASE_RECONCILER = path.join(REPOSITORY_ROOT, 'scripts/reconcile-github-release-assets.mjs');
const RELEASE_UPLOADER = path.join(REPOSITORY_ROOT, 'scripts/upload-github-release-assets.mjs');
const RELEASE_ASSET_CLEANUP = path.join(REPOSITORY_ROOT, 'scripts/cleanup-github-release-asset.mjs');
const RUST_TOOLCHAIN = path.join(REPOSITORY_ROOT, 'rust-toolchain.toml');
const WORKFLOW_DIRECTORY = path.join(REPOSITORY_ROOT, '.github/workflows');
const NO_UPDATER_ARTIFACTS_PROFILE = path.join(
  REPOSITORY_ROOT,
  'src-tauri/tauri.no-updater-artifacts.conf.json',
);
const NO_UPDATER_ARTIFACTS_PROFILE_ARGUMENT = /--config\s+src-tauri\/tauri\.no-updater-artifacts\.conf\.json/;

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function workflowRunBlocks(source) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const baseIndent = match[1].length;
    const block = [match[2]];
    if (/^[>|]/.test(match[2])) {
      for (index += 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim().length === 0 || line.search(/\S/) > baseIndent) {
          block.push(line);
          continue;
        }
        index -= 1;
        break;
      }
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

function workflowActionBlocks(source, actionName) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes(`uses: ${actionName}@`)) continue;
    const indent = lines[index].search(/\S/);
    const block = [lines[index]];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim().length > 0) {
        const lineIndent = line.search(/\S/);
        if (lineIndent < indent || (lineIndent === indent && /^\s*-\s+(?:name|uses):/.test(line))) {
          index -= 1;
          break;
        }
      }
      block.push(line);
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

function workflowJobBlock(source, jobName) {
  const marker = `\n  ${jobName}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `workflow job ${jobName} is missing`);
  const bodyStart = start + marker.length;
  const nextJob = source.slice(bodyStart).search(/\n  [a-z0-9-]+:\n/);
  return nextJob === -1
    ? source.slice(bodyStart)
    : source.slice(bodyStart, bodyStart + nextJob);
}

describe('collaboration release evidence topology', () => {
  test('all repository actions are pinned to immutable commit identities', async () => {
    const entries = await readdir(WORKFLOW_DIRECTORY);
    const workflowFiles = entries.filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'));
    assert.ok(workflowFiles.length > 0);
    for (const workflowFile of workflowFiles) {
      const source = await readFile(path.join(WORKFLOW_DIRECTORY, workflowFile), 'utf8');
      for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(?:#.*)?$/gm)) {
        const reference = match[1];
        assert.match(
          reference,
          /@[0-9a-f]{40}$|@sha256:[0-9a-f]{64}$/,
          `${workflowFile} contains a mutable action reference: ${reference}`,
        );
        const separator = reference.lastIndexOf('@');
        const action = reference.slice(0, separator);
        const pin = reference.slice(separator + 1);
        assert.equal(
          WORKFLOW_ACTION_PINS[action],
          pin,
          `${workflowFile} uses an unreviewed pin for ${action}`,
        );
      }
    }
  });

  test('workflow toolchain versions are exact and match package metadata', async () => {
    const packageJson = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
    assert.equal(packageJson.packageManager, 'pnpm@9.15.9');
    const rustToolchain = await readFile(RUST_TOOLCHAIN, 'utf8');
    assert.match(rustToolchain, /channel\s*=\s*"1\.96\.0"/);
    const workflowFiles = (await readdir(WORKFLOW_DIRECTORY))
      .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'));
    for (const workflowFile of workflowFiles) {
      const source = await readFile(path.join(WORKFLOW_DIRECTORY, workflowFile), 'utf8');
      for (const match of source.matchAll(/uses:\s*pnpm\/action-setup@[0-9a-f]{40}[\s\S]{0,180}?version:\s*([^\s#]+)/g)) {
        assert.equal(match[1], '9.15.9', `${workflowFile} must pin pnpm to 9.15.9`);
      }
    }
  });

  test('manual candidates cannot emit updater artifacts and CI does not package installers', async () => {
    const profile = JSON.parse(await readFile(NO_UPDATER_ARTIFACTS_PROFILE, 'utf8'));
    assert.equal(profile.bundle?.createUpdaterArtifacts, false);

    const ciSource = await readFile(path.join(WORKFLOW_DIRECTORY, 'ci.yml'), 'utf8');
    assert.doesNotMatch(ciSource, /(?:pnpm\s+)?tauri(?:-action|\s+build)|Build unsigned candidate/);

    for (const workflowFile of ['linux-self-hosted-release.yml', 'release.yml']) {
      const source = await readFile(path.join(WORKFLOW_DIRECTORY, workflowFile), 'utf8');
      const candidateBuilds = workflowRunBlocks(source)
        .filter((block) => /(?:pnpm\s+)?tauri(?:-action|\s+build)|Build unsigned candidate/.test(block));
      if (workflowFile === 'linux-self-hosted-release.yml') assert.ok(candidateBuilds.length > 0);
      assert.match(source, NO_UPDATER_ARTIFACTS_PROFILE_ARGUMENT);
    }
  });

  test('workflow inputs never interpolate directly into shell programs', async () => {
    const workflowFiles = (await readdir(WORKFLOW_DIRECTORY))
      .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'));
    for (const workflowFile of workflowFiles) {
      const source = await readFile(path.join(WORKFLOW_DIRECTORY, workflowFile), 'utf8');
      for (const block of workflowRunBlocks(source)) {
        assert.doesNotMatch(
          block,
          /\$\{\{\s*(?:inputs|github\.event\.inputs)\./,
          `${workflowFile} interpolates an untrusted workflow input directly into a shell program`,
        );
      }
    }
  });

  test('producer execution is source-bound and attestation permissions are isolated', async () => {
    for (const contract of RELEASE_EVIDENCE_TYPES) {
      const producerSource = await readFile(path.join(REPOSITORY_ROOT, contract.workflowPath), 'utf8');
      assert.match(producerSource, /source_sha:/, `${contract.id} must accept an immutable source SHA`);
      assert.match(producerSource, /git rev-parse 'HEAD\^\{commit\}'/, `${contract.id} must verify the checked-out commit`);
      assert.match(producerSource, /GITHUB_SHA.*GITHUB_EVENT_INPUTS_SOURCE_SHA|GITHUB_EVENT_INPUTS_SOURCE_SHA.*GITHUB_SHA/s);
      const produceSection = producerSource.split(/\n\s+attest:\n/, 1)[0];
      assert.doesNotMatch(produceSection, /id-token:\s*write/);
      assert.doesNotMatch(produceSection, /attestations:\s*write/);
      assert.match(producerSource, /persist-credentials:\s*false/);
      assert.match(producerSource, /TRUSTED_PROMOTION_REQUIRED/);
      assert.match(producerSource, /scan-evidence-artifacts\.mjs/);
      const blockedUpload = producerSource
        .split(/\n\s+- name: Upload blocked producer diagnostics\n/).at(-1)
        ?.split(/\n\s+- name:/, 1)[0] ?? '';
      assert.match(blockedUpload, /if: failure\(\) && steps\.scan-evidence\.outcome == 'success'/);
      assert.match(blockedUpload, new RegExp(`path: release-evidence/${contract.id}/blocker\\.json`));
      assert.doesNotMatch(blockedUpload, new RegExp(`path: release-evidence/${contract.id}/\\s*$`, 'm'));
      assert.ok(
        producerSource.indexOf('Require provisioned') < producerSource.indexOf('pnpm install --frozen-lockfile'),
        `${contract.id} must block an absent real harness before dependency lifecycle scripts`,
      );
    }
    const soakSource = await readFile(
      path.join(REPOSITORY_ROOT, '.github/workflows/collaboration-soak-release-evidence.yml'),
      'utf8',
    );
    assert.match(soakSource, /runner-preflight:/);
    assert.match(soakSource, /ephemeral/);
  });

  test('candidate release jobs cannot mint trusted attestations', async () => {
    const releaseSource = await readFile(RELEASE_WORKFLOW, 'utf8');
    for (const jobName of [
      'quality-evidence-attest',
      'gateway-structural-smoke-attest',
      'release-asset-manifest-attest',
      'external-release-decision-attest',
    ]) {
      const job = workflowJobBlock(releaseSource, jobName);
      assert.match(job, /attestations:\s*write/);
      assert.match(
        job,
        /if:.*needs\.verify-version\.outputs\.signing-enabled == 'true'/,
        `${jobName} must be unreachable from an unsigned candidate`,
      );
    }

    const buildJob = workflowJobBlock(releaseSource, 'build');
    assert.match(buildJob, /needs: \[verify-version, quality-evidence, gateway-structural-smoke\]/);
    assert.doesNotMatch(buildJob, /needs:.*-attest/);
  });

  test('workflow artifacts are run-scoped and explicitly replaceable on same-run retries', async () => {
    const workflowFiles = (await readdir(WORKFLOW_DIRECTORY))
      .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
      .sort();
    let uploadCount = 0;
    for (const workflowFile of workflowFiles) {
      const source = await readFile(path.join(WORKFLOW_DIRECTORY, workflowFile), 'utf8');
      const uploads = workflowActionBlocks(source, 'actions/upload-artifact');
      uploadCount += uploads.length;
      for (const upload of uploads) {
        assert.match(upload, /name:.*\$\{\{ github\.run_id \}\}/);
        assert.doesNotMatch(upload, /github\.run_attempt/);
        assert.match(upload, /overwrite:\s*true/);
      }
    }
    assert.ok(uploadCount > 0, 'repository workflows must contain upload-artifact jobs');
  });

  test('canonical producer paths are regular repository files and release wiring is exact', async () => {
    const releaseSource = await readFile(RELEASE_WORKFLOW, 'utf8');
    const seenPaths = new Set();

    for (const contract of RELEASE_EVIDENCE_TYPES) {
      assert.equal(seenPaths.has(contract.workflowPath), false, `duplicate workflow path: ${contract.workflowPath}`);
      seenPaths.add(contract.workflowPath);
      assert.equal(TRUSTED_EVIDENCE_WORKFLOWS[contract.key], contract.workflowPath);

      const workflowPath = path.join(REPOSITORY_ROOT, contract.workflowPath);
      const workflowStat = await lstat(workflowPath);
      assert.equal(workflowStat.isSymbolicLink(), false, `${contract.workflowPath} must not be a symlink`);
      assert.equal(workflowStat.isFile(), true, `${contract.workflowPath} must be a regular file`);

      const producerSource = await readFile(workflowPath, 'utf8');
      assert.match(producerSource, /workflow_dispatch:/, `${contract.id} producer must be manually dispatchable`);
      assert.match(producerSource, /actions\/upload-artifact@[0-9a-f]{40}/, `${contract.id} producer must upload its evidence`);
      assert.match(producerSource, /actions\/attest@[0-9a-f]{40}/, `${contract.id} producer must attest its evidence`);
      assert.ok(
        countOccurrences(producerSource, contract.artifactName) >= 1,
        `${contract.id} producer must use ${contract.artifactName}`,
      );
      assert.ok(
        countOccurrences(producerSource, contract.evidenceFile) >= 1,
        `${contract.id} producer must use ${contract.evidenceFile}`,
      );
      assert.match(
        producerSource,
        new RegExp(`path: release-evidence/${contract.id}/publish/`),
        `${contract.id} producer must upload its complete publish artifact root`,
      );

      assert.ok(
        countOccurrences(releaseSource, contract.workflowPath) >= 1,
        `release workflow must reference ${contract.workflowPath}`,
      );
      assert.ok(
        countOccurrences(releaseSource, contract.artifactName) >= 1,
        `release workflow must retrieve ${contract.artifactName}`,
      );
      assert.ok(
        countOccurrences(releaseSource, contract.evidenceFile) >= 1,
        `release workflow must address ${contract.evidenceFile}`,
      );
    }
  });

  test('trusted workflow paths are unique and all evidence types are represented', () => {
    assert.deepEqual(
      Object.keys(TRUSTED_EVIDENCE_WORKFLOWS).sort(),
      ['GATEWAY', 'SOAK', 'VISUAL'],
    );
    assert.equal(new Set(Object.values(TRUSTED_EVIDENCE_WORKFLOWS)).size, RELEASE_EVIDENCE_TYPES.length);
  });

  test('release DAG retains provenance, decision, and publication gates', async () => {
    const releaseSource = await readFile(RELEASE_WORKFLOW, 'utf8');
    const releaseAssetVerifier = await readFile(RELEASE_ASSET_VERIFIER, 'utf8');
    const sourcePolicy = await readFile(RELEASE_SOURCE_POLICY, 'utf8');
    const publicationStager = await readFile(RELEASE_PUBLICATION_STAGER, 'utf8');
    const releaseInspector = await readFile(RELEASE_INSPECTOR, 'utf8');
    const releaseMutationAdapter = await readFile(RELEASE_MUTATION_ADAPTER, 'utf8');
    const releaseReconciler = await readFile(RELEASE_RECONCILER, 'utf8');
    const releaseUploader = await readFile(RELEASE_UPLOADER, 'utf8');
    const releaseAssetCleanup = await readFile(RELEASE_ASSET_CLEANUP, 'utf8');
    assert.match(releaseSource, /release-asset-manifest:/);
    assert.match(releaseSource, /create-release-asset-manifest\.mjs/);
    assert.match(
      releaseSource,
      /collaboration-release-decision-\$\{\{ needs\.verify-version\.outputs\.source-sha \}\}-\$\{\{ github\.run_id \}\}/,
    );
    assert.match(releaseSource, /--source-sha \"\$EXPECTED_SOURCE_SHA\"/);
    assert.match(releaseSource, /needs: \[verify-version, quality-node,[^\n]*publish\]/);
    assert.match(releaseSource, /Tagged build passed prerequisites but GitHub Release publication did not succeed/);
    assert.doesNotMatch(releaseSource, /tags:\s*\[/, 'tag pushes must not load tag-owned workflow code');
    assert.match(sourcePolicy, /TRUSTED_PROMOTION_REQUIRED/);
    assert.doesNotMatch(sourcePolicy, /signingEnabled:\s*true/);
    assert.match(releaseSource, NO_UPDATER_ARTIFACTS_PROFILE_ARGUMENT);
    assert.match(releaseSource, /Build unsigned candidate/);
    assert.match(releaseSource, /Verify protected macOS signing inputs/);
    assert.match(releaseSource, /Build signed macOS Tauri release/);
    assert.match(releaseSource, /Build signed Windows Tauri release/);
    const windowsSignedBuild = releaseSource
      .split(/\n\s+- name: Build signed Windows Tauri release\n/).at(-1)
      ?.split(/\n\s+- name:/, 1)[0] ?? '';
    assert.doesNotMatch(
      windowsSignedBuild,
      /APPLE_(?:CERTIFICATE|ID|PASSWORD|TEAM_ID|SIGNING_IDENTITY)/,
    );
    assert.match(releaseSource, /Sign Windows installers with Authenticode/);
    assert.match(releaseSource, /Create draft GitHub Release and verify immutable assets/);
    assert.match(releaseSource, /Stage immutable publication snapshot/);
    assert.match(releaseSource, /stage-release-publication\.mjs/);
    assert.match(releaseSource, /--seal-output "\$RUNNER_TEMP\/release-publication-seal\.json"/);
    assert.match(releaseSource, /Lock sealed publication snapshot/);
    assert.match(releaseSource, /--seal "\$RUNNER_TEMP\/release-publication-seal\.json"/);
    assert.match(releaseSource, /--seal-sha "\$EXPECTED_SEAL_SHA"/);
    assert.match(releaseSource, /actual_seal_sha=.*sha256sum/);
    assert.equal(countOccurrences(releaseSource, '--seal-sha "$EXPECTED_SEAL_SHA"'), 5);
    assert.match(releaseSource, /mutate-github-release\.mjs/);
    assert.match(releaseSource, /reconcile-github-release-assets\.mjs/);
    assert.doesNotMatch(releaseSource, /gh release create/);
    assert.doesNotMatch(releaseSource, /gh api\s+--method\s+PATCH/);
    assert.match(releaseMutationAdapter, /createGitHubRelease/);
    assert.match(releaseMutationAdapter, /publishGitHubRelease/);
    assert.match(releaseMutationAdapter, /sourceMarker/);
    assert.match(releaseMutationAdapter, /candidateReleaseId/);
    assert.match(releaseMutationAdapter, /CREATE_AMBIGUOUS_UNRESOLVED/);
    assert.match(releaseMutationAdapter, /PUBLISH_AMBIGUOUS_UNRESOLVED/);
    assert.match(releaseSource, /\.release\.id == \.releaseId/);
    assert.match(releaseSource, /\.release\.tagName == \$tag/);
    assert.match(releaseSource, /\.release\.body \| contains\(\$marker\)/);
    assert.match(releaseSource, /upload-github-release-assets\.mjs/);
    assert.doesNotMatch(releaseSource, /gh release upload/);
    assert.match(releaseSource, /Release transaction converged through the Node adapter/);
    assert.doesNotMatch(releaseSource, /DELETE\s+"repos\/\$GITHUB_REPOSITORY\/releases/);
    assert.match(publicationStager, /copyStableFile/);
    assert.match(publicationStager, /createReleasePublicationSeal/);
    assert.match(publicationStager, /MANIFEST_ASSET_SET_MISMATCH/);
    assert.match(releaseReconciler, /planReleaseAssetUploads/);
    assert.match(releaseReconciler, /REMOTE_ASSET_CONFLICT/);
    assert.match(releaseAssetCleanup, /fetchReleaseAssetById/);
    assert.match(releaseAssetCleanup, /RELEASE_NOT_DRAFT/);
    assert.match(releaseUploader, /buildReleaseAssetUploadUrl/);
    assert.match(releaseUploader, /cleanupOwnedStarterAsset/);
    assert.match(releaseUploader, /calculateUploadDeadlineMs/);
    assert.match(releaseUploader, /releaseId/);
    assert.match(releaseUploader, /O_NOFOLLOW/);
    for (const adapterSource of [releaseReconciler, releaseUploader, releaseAssetVerifier]) {
      assert.match(adapterSource, /assertReleasePublicationSealMatchesAssets\(publicationSeal, localAssets/);
      assert.match(adapterSource, /releaseRef:/);
      assert.match(adapterSource, /refs\/tags/);
      assert.match(adapterSource, /\$\{tag\}/);
    }
    assert.doesNotMatch(releaseUploader, /releases\/tags\//);
    assert.match(releaseInspector, /status: 'ABSENT'/);
    assert.match(releaseInspector, /releases\?per_page=/);
    assert.doesNotMatch(releaseInspector, /releases\/tags\//);
    assert.equal(countOccurrences(releaseSource, 'verify-github-release-assets.mjs'), 3);
    assert.equal(countOccurrences(releaseSource, '--release-id "$release_id"'), 6);
    assert.equal(countOccurrences(releaseSource, '--expected-state draft'), 1);
    assert.equal(countOccurrences(releaseSource, '--expected-state published'), 2);
    assert.doesNotMatch(releaseAssetVerifier, /releases\/tags\//);
    assert.match(releaseAssetVerifier, /releases\/\$\{releaseId\}/);
    assert.match(releaseAssetVerifier, /RELEASE_OWNERSHIP_MISMATCH/);
    assert.match(releaseAssetVerifier, /REMOTE_ASSET_NOT_UPLOADED/);
    assert.match(releaseSource, /verify-github-tag-target\.mjs/);
    assert.match(releaseSource, /Verify tag target commit/);
    assert.equal(countOccurrences(releaseSource, 'verify-github-tag-target.mjs'), 4);
    assert.doesNotMatch(releaseSource, /--clobber/);
    assert.match(releaseSource, /environment: production-release/);
    const publishJob = workflowJobBlock(releaseSource, 'publish');
    assert.match(publishJob, /timeout-minutes:\s*150/);
    const externalGateSection = releaseSource.split(/\n\s+external-release-decision-attest:\n/, 1)[0].split(/\n\s+external-release-gate:\n/).at(-1);
    assert.match(externalGateSection, /attestations:\s*read/);
    assert.match(externalGateSection, /if: always\(\) && needs\.verify-version\.outputs\.signing-enabled == 'true'/);
    assert.match(externalGateSection, /Require trusted release prerequisites/);
    assert.doesNotMatch(
      externalGateSection,
      /\|\s*tee\s+external-release-evidence\/release-decision\.json/,
    );
    assert.match(externalGateSection, /decision_tmp=.*release-decision\.json\.tmp/);
    assert.match(externalGateSection, /validator_status=\$\?/);
    assert.match(externalGateSection, /evidence_run_attempt=.*workflow\.runAttempt/);
    assert.match(externalGateSection, /\.workflow\.runAttempt[\s\S]*\. <= \$latestAttempt/);
    assert.doesNotMatch(
      externalGateSection,
      /rm -f "\$decision_tmp" external-release-evidence\/release-decision\.json/,
    );
    assert.match(
      externalGateSection,
      /mv -f -- "\$decision_tmp" external-release-evidence\/release-decision\.json/,
    );
    assert.match(externalGateSection, /Prepare and scan durable release decision snapshot/);
    assert.match(externalGateSection, /scan-evidence-artifacts\.mjs --root release-decision-publish/);
    assert.match(externalGateSection, /if: always\(\) && steps\.decision-snapshot\.outcome == 'success'/);
    assert.match(releaseSource, /Verify durable release decision before publication/);
    assert.match(releaseSource, /\.kind == \"SATISFIED\"/);
  });
});
