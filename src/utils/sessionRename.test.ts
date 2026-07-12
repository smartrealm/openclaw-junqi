import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import '../../test-setup';
import { useChatStore, type Session } from '../stores/chatStore';
import { useGatewayDataStore } from '../stores/gatewayDataStore';
import { __setSessionRenameDepsForTest, applySessionRename } from './sessionRename';

const TEST_KEY = 'agent:test:rename-1';

function seedSession(label = 'Original Label'): Session {
  const session: Session = {
    key: TEST_KEY,
    label,
    lastMessage: 'previous turn',
    lastTimestamp: '2026-01-01T00:00:00.000Z',
  };
  useChatStore.setState({ sessions: [session] });
  return session;
}

function chatLabel(): string | undefined {
  return useChatStore.getState().sessions.find((session) => session.key === TEST_KEY)?.label;
}

describe('applySessionRename', () => {
  let patches: Array<{ key: string; label: string | null }>;
  let warnings: unknown[][];

  beforeEach(() => {
    patches = [];
    warnings = [];
    useChatStore.setState({ sessions: [] });
    useGatewayDataStore.setState({ sessions: [] });
    __setSessionRenameDepsForTest({
      patchLabel: async (key, label) => {
        patches.push({ key, label });
        return { entry: label === null ? {} : { label } };
      },
      warn: (...args) => warnings.push(args),
    });
  });

  test('updates local views only after Gateway confirms the rename', async () => {
    const session = seedSession('Before');
    useGatewayDataStore.setState({ sessions: [{ key: TEST_KEY, label: 'Before' }] });

    const result = await applySessionRename(TEST_KEY, '  After  ');

    assert.deepEqual(result, { ok: true, label: 'After' });
    assert.deepEqual(patches, [{ key: TEST_KEY, label: 'After' }]);
    assert.equal(chatLabel(), 'After');
    assert.equal(useGatewayDataStore.getState().sessions[0]?.label, 'After');
    assert.equal(useChatStore.getState().sessions[0]?.lastMessage, session.lastMessage);
  });

  test('uses label null to clear an OpenClaw-native custom label', async () => {
    seedSession('Custom title');

    const result = await applySessionRename(TEST_KEY, '   ');

    assert.deepEqual(result, { ok: true, label: '' });
    assert.deepEqual(patches, [{ key: TEST_KEY, label: null }]);
    assert.equal(chatLabel(), '');
  });

  test('uses the Gateway-confirmed label instead of assuming the requested value', async () => {
    seedSession('Before');
    __setSessionRenameDepsForTest({
      patchLabel: async (key, label) => {
        patches.push({ key, label });
        return { entry: { label: 'Confirmed by Gateway' } };
      },
      warn: (...args) => warnings.push(args),
    });

    const result = await applySessionRename(TEST_KEY, 'Requested label');

    assert.deepEqual(result, { ok: true, label: 'Confirmed by Gateway' });
    assert.equal(chatLabel(), 'Confirmed by Gateway');
  });

  test('does not mutate local state when Gateway rejects the mutation', async () => {
    seedSession('Original');
    __setSessionRenameDepsForTest({
      patchLabel: async () => {
        throw new Error('label already in use');
      },
      warn: (...args) => warnings.push(args),
    });

    const result = await applySessionRename(TEST_KEY, 'Duplicate');

    assert.deepEqual(result, { ok: false, error: 'label already in use' });
    assert.equal(chatLabel(), 'Original');
    assert.equal(warnings.length, 1);
  });

  test('still sends a native mutation for a session not present in local state', async () => {
    const result = await applySessionRename('agent:missing:session', 'Remote label');

    assert.deepEqual(result, { ok: true, label: 'Remote label' });
    assert.deepEqual(patches, [{ key: 'agent:missing:session', label: 'Remote label' }]);
  });

  test('rejects a missing session key without making a Gateway request', async () => {
    const result = await applySessionRename('   ', 'Name');

    assert.deepEqual(result, { ok: false, error: 'Missing session key' });
    assert.deepEqual(patches, []);
  });
});
