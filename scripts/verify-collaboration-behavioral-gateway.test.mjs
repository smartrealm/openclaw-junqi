import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  DETERMINISTIC_PROVIDER_DESTINATION,
  OFFICIAL_OPENCLAW_IMAGE,
  buildProviderSidecarRunArgs,
} from './verify-collaboration-real-gateway.mjs';
import {
  assertProviderMountAllowlist,
  behavioralBootstrapPlan,
  createNativeMessageDeltaSpecification,
  deterministicModelsConfig,
  nativeHistoryMessageId,
  safeBehavioralErrorForEvidence,
  stableStringify,
  summarizeHistoryContentShapes,
  validateBehavioralEvidence,
  writeEnvelope,
} from './verify-collaboration-behavioral-gateway.mjs';
import {
  GATEWAY_EVIDENCE_LOG_POLICY,
  REDACTED_GATEWAY_OUTPUT,
  sanitizeGatewayEvidenceLog,
} from './evidence-log-sanitizer.mjs';

describe('behavioral Gateway contracts', () => {
  test('projects failure diagnostics without retaining upstream message content', () => {
    const sentinel = 'private-failure-sentinel';
    const error = Object.assign(new Error(`provider failed with ${sentinel}`), {
      code: 'PROVIDER_FAILURE',
    });
    const projected = safeBehavioralErrorForEvidence(error);
    assert.equal(JSON.stringify(projected).includes(sentinel), false);
    assert.equal(projected.code, 'PROVIDER_FAILURE');
    assert.equal(projected.messageBytes, Buffer.byteLength(error.message));
    assert.match(projected.messageSha256, /^[a-f0-9]{64}$/u);
  });

  test('keeps component diagnostics but fail-closed redacts bare or private Gateway output', () => {
    const privateGoal = 'private behavioral goal';
    const result = sanitizeGatewayEvidenceLog([
      '2026-07-18T20:21:25.481169000Z 2026-07-18T20:21:25.480+00:00 [gateway] ready',
      `2026-07-18T20:21:40.936585090Z 2026-07-18T20:21:40.935+00:00 {"goal":"${privateGoal}","workItems":[]}`,
      '2026-07-18T20:21:45.250095009Z 2026-07-18T20:21:45.249+00:00 model answer',
      `2026-07-18T20:21:46.250095009Z 2026-07-18T20:21:46.249+00:00 [plugins] debug goal=${privateGoal}`,
      'log shape without a timestamp',
      '',
    ].join('\n'), { privateFragments: [privateGoal] });

    assert.equal(result.policy, GATEWAY_EVIDENCE_LOG_POLICY);
    assert.equal(result.preservedLineCount, 1);
    assert.equal(result.redactedLineCount, 4);
    assert.equal(result.privateFragmentCount, 0);
    assert.equal(result.text.includes(privateGoal), false);
    assert.match(result.text, /\[OPERATIONAL_EVENT:GATEWAY_READY\]/u);
    assert.equal(result.text.split(REDACTED_GATEWAY_OUTPUT).length - 1, 4);
    assert.equal(result.text.endsWith('\n'), true);
  });

  test('hashes write envelopes with recursive canonical key ordering', () => {
    const first = writeEnvelope({
      commandId: 'command-1',
      expectedCollaborationInstanceId: 'instance-1',
      nested: { beta: 2, alpha: 1 },
      runId: 'run-1',
    });
    const second = writeEnvelope({
      commandId: 'another-command',
      expectedCollaborationInstanceId: 'instance-1',
      runId: 'run-1',
      nested: { alpha: 1, beta: 2 },
    });
    assert.equal(first.payloadHash, second.payloadHash);
    assert.equal(stableStringify({ z: 1, a: [2, { y: true, x: null }] }), '{"a":[2,{"x":null,"y":true}],"z":1}');
    assert.throws(
      () => writeEnvelope({ commandId: 'missing-instance', runId: 'run-1' }),
      (error) => error?.code === 'INSTANCE_FENCE_MISSING',
    );
  });

  test('reads the stable OpenClaw transcript id from native history metadata', () => {
    assert.equal(nativeHistoryMessageId({ __openclaw: { id: 'native-message-1', seq: 4 } }), 'native-message-1');
    assert.equal(nativeHistoryMessageId({ message: { messageId: 'native-message-2' } }), 'native-message-2');
    assert.equal(nativeHistoryMessageId({ id: 'legacy-message-3', __openclaw: { id: 'native-message-3' } }), 'native-message-3');
    assert.equal(nativeHistoryMessageId({
      id: 'outer-envelope-id',
      message: { id: 'nested-legacy-id', __openclaw: { id: 'nested-native-id' } },
    }), 'nested-native-id');
  });

  test('summarizes real history-compatible content shapes without retaining content', () => {
    const secret = 'must-not-be-persisted';
    const summary = summarizeHistoryContentShapes([
      { content: [{ type: 'text', text: secret }, { type: 'toolCall', arguments: secret }] },
      { content: secret },
      { content: [{ type: 'text', text: 'different' }] },
    ]);
    assert.deepEqual(summary, [
      { contentType: 'array', blockTypes: ['text', 'toolCall'] },
      { contentType: 'array', blockTypes: ['text'] },
      { contentType: 'string', blockTypes: [] },
    ]);
    assert.equal(JSON.stringify(summary).includes(secret), false);
  });

  test('evaluates exactly-once transcript delivery by native message identity', () => {
    const marker = 'JUNQI_DETERMINISTIC_SYNTHESIS_OK';
    const message = (id, text = marker) => ({
      role: 'assistant',
      content: [{ type: 'text', text }],
      __openclaw: { id },
    });
    const baselineMessage = message('message-before-scenario');
    const deliveredMessage = message('message-delivered');
    const duplicateDelivery = message('message-duplicate');
    const specification = createNativeMessageDeltaSpecification(
      [baselineMessage],
      (candidate) => candidate.content.some((part) => part.text.includes(marker)),
    );

    assert.deepEqual(
      specification.selectAdded([baselineMessage, deliveredMessage]),
      [deliveredMessage],
      'a pre-existing message with the same marker is not owned by this scenario',
    );
    assert.equal(
      specification.expectExactlyOneAdded([baselineMessage, deliveredMessage, deliveredMessage]),
      deliveredMessage,
      'replaying the same native message id does not create another delivery',
    );
    assert.throws(
      () => specification.expectExactlyOneAdded([
        baselineMessage,
        deliveredMessage,
        duplicateDelivery,
      ], 'scenario must add exactly one message'),
      (error) => error?.code === 'TRANSCRIPT_DUPLICATED'
        && error?.details?.baselineCount === 1
        && error?.details?.newMessageCount === 2,
      'a second new native message id violates exactly-once delivery',
    );
  });

  test('configures a local Responses provider with private-network opt-in and no external credential', () => {
    const config = deterministicModelsConfig();
    const provider = config.providers['junqi-qa'];
    assert.equal(provider.api, 'openai-responses');
    assert.equal(provider.request.allowPrivateNetwork, true);
    assert.equal(provider.apiKey, 'test');
    assert.match(provider.baseUrl, /^http:\/\/qa-provider:44080\/v1$/);
    const plan = behavioralBootstrapPlan({ pluginId: 'junqi-collab' }, 53_111);
    assert.ok(plan.some((step) => step.id === 'models'));
    assert.ok(plan.some((step) => step.id === 'agents' && step.args.join(' ').includes('junqi-qa/deterministic')));
  });

  test('builds a hardened provider sidecar with only a read-only source mount', () => {
    const sourcePath = path.resolve('/tmp/provider.mjs');
    const args = buildProviderSidecarRunArgs({
      containerName: 'junqi-provider',
      networkName: 'junqi-runtime',
      networkAlias: 'qa-provider',
      sourcePath,
      runId: 'run-1',
    });
    assert.ok(args.includes(OFFICIAL_OPENCLAW_IMAGE));
    assert.ok(args.includes('--read-only'));
    assert.ok(args.includes('no-new-privileges:true'));
    assert.equal(args.includes('--publish'), false);
    assert.equal(args.some((argument) => argument.includes('/home/node/.openclaw')), false);
    assert.equal(args.filter((argument) => argument === '--mount').length, 1);
    assert.ok(args.includes(`type=bind,source=${sourcePath},target=${DETERMINISTIC_PROVIDER_DESTINATION},readonly`));

    assert.deepEqual(assertProviderMountAllowlist([{
      Type: 'bind',
      Source: sourcePath,
      Destination: DETERMINISTIC_PROVIDER_DESTINATION,
      RW: false,
    }], sourcePath), [{
      type: 'bind',
      source: sourcePath,
      destination: DETERMINISTIC_PROVIDER_DESTINATION,
      readWrite: false,
    }]);
  });

  test('rejects behavioral evidence that overclaims Desktop or reset coverage', () => {
    const evidence = {
      formatVersion: 1,
      kind: 'JUNQI_COLLABORATION_REAL_GATEWAY_BEHAVIORAL',
      scope: 'ISOLATED_REAL_GATEWAY_BEHAVIORAL_P0_AUTOMATED',
      isolation: { runtimeNetworkInternal: true, hostPortPublished: false },
      provider: { externalApiKeyUsed: false, promptContentPersisted: false },
      logPrivacy: {
        policy: GATEWAY_EVIDENCE_LOG_POLICY,
        sentinelSha256: 'a'.repeat(64),
        modelOutputPersisted: false,
        privateFragmentCount: 0,
        providerPrivateFragmentCount: 0,
        failurePrivateFragmentCount: 0,
        redactedLineCount: 1,
      },
      claims: Object.fromEntries([
        'P0-02', 'P0-03', 'P0-05', 'P0-06', 'P0-07', 'P0-08',
      ].map((id) => [id, { status: 'VERIFIED' }])),
    };
    evidence.claims['P0-04'] = { status: 'NOT_VERIFIED' };
    evidence.claims['P0-09'] = { status: 'NOT_IN_SCOPE' };
    evidence.claims['P0-10'] = { status: 'NOT_IN_SCOPE' };
    evidence.claims['P0-13'] = { status: 'NOT_IN_SCOPE' };
    evidence.claims['P0-14'] = { status: 'NOT_IN_SCOPE' };
    assert.equal(validateBehavioralEvidence(evidence), evidence);
    assert.throws(
      () => validateBehavioralEvidence({
        ...evidence,
        claims: { ...evidence.claims, 'P0-09': { status: 'VERIFIED' } },
      }),
      /must not be claimed/,
    );
    assert.throws(
      () => validateBehavioralEvidence({
        ...evidence,
        claims: { ...evidence.claims, 'P0-14': { status: 'VERIFIED' } },
      }),
      /must not be claimed/,
    );
  });
});
