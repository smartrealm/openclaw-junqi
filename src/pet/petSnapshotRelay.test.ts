import assert from 'node:assert/strict';
import test from 'node:test';
import { PetSnapshotRelay } from './petSnapshotRelay';
import type { PetState } from './pet-states';

test('a ready pet window receives the latest snapshot even when it missed the initial broadcast', () => {
  const delivered: PetState[] = [];
  const relay = new PetSnapshotRelay((state) => delivered.push(state));
  const initial: PetState = {
    emotion: 'thinking',
    message: 'Preparing a response',
    presentation: {
      soundEnabled: false,
      backdropContrastEnabled: true,
      captionScale: 1.2,
    },
  };

  relay.publish(initial);
  relay.replayLatest();

  assert.deepEqual(delivered, [initial, initial]);
});
