import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceModeCoordinator, type VoiceModeContext } from './VoiceModeCoordinator';

const context = (sessionKey = 'agent:main:main', connectionId = 'connection-a'): VoiceModeContext => ({
  sessionKey,
  connectionId,
});

test('VWS-01 drops events from a stopped or replaced voice turn', () => {
  const coordinator = new VoiceModeCoordinator();
  const first = coordinator.start({ mode: 'dictation', context: context(), wakeDetectorAvailable: false });
  coordinator.stop();
  const second = coordinator.start({ mode: 'dictation', context: context(), wakeDetectorAvailable: false });

  assert.equal(coordinator.acceptTranscript(first.turnId, context(), 'stale'), false);
  assert.equal(coordinator.acceptTranscript(second.turnId, context(), 'current'), true);
  const draft = coordinator.getSnapshot().draft;
  assert.equal(draft?.kind, 'transcript');
  if (draft?.kind === 'transcript') assert.equal(draft.text, 'current');
});

test('VWS-01 stop is idempotent and late capture cannot revive the coordinator', () => {
  const coordinator = new VoiceModeCoordinator();
  const snapshot = coordinator.start({ mode: 'dictation', context: context(), wakeDetectorAvailable: false });
  assert.equal(coordinator.stop(), true);
  assert.equal(coordinator.stop(), false);
  assert.equal(coordinator.acceptAudioCapture(snapshot.turnId, context(), 4), null);
  assert.equal(coordinator.getSnapshot().phase, 'off');
});

test('VWS-01 stop releases registered capture owners after fencing the turn', async () => {
  const coordinator = new VoiceModeCoordinator();
  const stopped: string[] = [];
  coordinator.subscribeCaptureStop(async () => {
    stopped.push('capture');
  });
  coordinator.start({ mode: 'dictation', context: context(), wakeDetectorAvailable: false });

  assert.equal(await coordinator.stopAndReleaseCapture(), true);
  assert.deepEqual(stopped, ['capture']);
  assert.equal(await coordinator.stopAndReleaseCapture(), false);
});

test('VWS-02 capture creates a draft without an external send side effect', () => {
  const coordinator = new VoiceModeCoordinator();
  const snapshot = coordinator.start({ mode: 'dictation', context: context(), wakeDetectorAvailable: false });
  const draft = coordinator.acceptAudioCapture(snapshot.turnId, context(), 3.8);

  assert.deepEqual(draft, {
    kind: 'audio',
    captureId: 'voice-capture-1',
    durationSec: 4,
    createdAt: draft?.createdAt,
    turnId: snapshot.turnId,
  });
  assert.equal(coordinator.getSnapshot().phase, 'ready_to_send');
  assert.equal(coordinator.getSnapshot().draft?.kind, 'audio');
});

test('VWS-01 context changes preserve a draft but block its submission', () => {
  const coordinator = new VoiceModeCoordinator();
  const original = context();
  const snapshot = coordinator.start({ mode: 'dictation', context: original, wakeDetectorAvailable: false });
  assert.equal(coordinator.acceptTranscript(snapshot.turnId, original, 'keep this draft'), true);
  assert.equal(coordinator.invalidateContext(context('agent:other:main', 'connection-b')), true);
  assert.equal(coordinator.getSnapshot().draft?.kind, 'transcript');
  assert.equal(coordinator.takeDraft(snapshot.turnId, original), null);
  assert.equal(coordinator.getSnapshot().error, 'target_changed');
  assert.equal(coordinator.discardDraft(null, context('agent:other:main', 'connection-b')), true);
  assert.equal(coordinator.getSnapshot().draft, null);
});

test('VWS-01 owner cleanup releases only the active hook turn', async () => {
  const coordinator = new VoiceModeCoordinator();
  const owner = context();
  const other = context('agent:other:main', 'connection-b');
  const released: string[] = [];
  coordinator.subscribeCaptureStop(() => {
    released.push('capture');
  });

  const first = coordinator.start({ mode: 'dictation', context: owner, wakeDetectorAvailable: false });
  assert.equal(coordinator.acceptTranscript(first.turnId, owner, 'draft before unmount'), true);
  assert.equal(await coordinator.stopOwnedTurnAndReleaseCapture(first.turnId, other), false);
  assert.equal(coordinator.getSnapshot().draft?.kind, 'transcript');

  assert.equal(await coordinator.stopOwnedTurnAndReleaseCapture(first.turnId, owner), true);
  assert.equal(coordinator.getSnapshot().phase, 'off');
  assert.equal(coordinator.getSnapshot().draft, null);
  assert.deepEqual(released, ['capture']);

  const replacement = coordinator.start({ mode: 'dictation', context: owner, wakeDetectorAvailable: false });
  assert.equal(await coordinator.stopOwnedTurnAndReleaseCapture(first.turnId, owner), false);
  assert.equal(coordinator.getSnapshot().turnId, replacement.turnId);
});

test('VWS-01 ownership fence preserves a draft when Gateway identity is invalidated', () => {
  const coordinator = new VoiceModeCoordinator();
  const owner = context();
  const turn = coordinator.start({ mode: 'dictation', context: owner, wakeDetectorAvailable: false });
  assert.equal(coordinator.acceptTranscript(turn.turnId, owner, 'do not send after reconnect'), true);

  assert.equal(coordinator.invalidateOwnedTurn(turn.turnId, context('agent:other:main'), 'gateway_unavailable'), false);
  assert.equal(coordinator.invalidateOwnedTurn(turn.turnId, owner, 'gateway_unavailable'), true);
  assert.equal(coordinator.getSnapshot().phase, 'error');
  assert.equal(coordinator.getSnapshot().error, 'gateway_unavailable');
  assert.equal(coordinator.getSnapshot().draft?.kind, 'transcript');
});

test('VWS-02 allows a disconnected stale draft to be discarded without a context', () => {
  const coordinator = new VoiceModeCoordinator();
  const original = context();
  const snapshot = coordinator.start({ mode: 'dictation', context: original, wakeDetectorAvailable: false });
  assert.equal(coordinator.acceptTranscript(snapshot.turnId, original, 'discard after disconnect'), true);
  assert.equal(coordinator.invalidate('gateway_unavailable'), true);

  assert.equal(coordinator.takeDraft(snapshot.turnId, original), null);
  assert.equal(coordinator.discardDraft(null, null), true);
  assert.equal(coordinator.getSnapshot().phase, 'off');
  assert.equal(coordinator.getSnapshot().draft, null);
});

test('VWS-03 does not present VAD as a wake detector', () => {
  const coordinator = new VoiceModeCoordinator();
  const snapshot = coordinator.start({ mode: 'wake_word', context: context(), wakeDetectorAvailable: false });

  assert.equal(snapshot.phase, 'unavailable');
  assert.equal(snapshot.error, 'wake_detector_unavailable');
});

test('a failed Jarvis category assignment leaves the wake turn recoverable and non-dispatching', () => {
  const coordinator = new VoiceModeCoordinator();
  const owner = context();
  const snapshot = coordinator.start({ mode: 'wake_word', context: owner, wakeDetectorAvailable: true });

  assert.equal(coordinator.markTriggered(snapshot.turnId, owner), true);
  assert.equal(
    coordinator.reportUnavailable(snapshot.turnId, owner, 'session_category_unavailable'),
    true,
  );
  assert.equal(coordinator.getSnapshot().phase, 'error');
  assert.equal(coordinator.getSnapshot().error, 'session_category_unavailable');
  assert.equal(coordinator.acceptAudioCapture(snapshot.turnId, owner, 1), null);
});
