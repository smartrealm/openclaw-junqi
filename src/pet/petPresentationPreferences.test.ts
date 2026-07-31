import assert from 'node:assert/strict';
import test from 'node:test';
import { usePetStore } from '@/stores/petStore';

test('a presentation snapshot updates all pet-only preferences atomically', () => {
  const original = usePetStore.getState();
  try {
    usePetStore.getState().setPresentationPreferences({
      soundEnabled: false,
      backdropContrastEnabled: false,
      captionScale: 1.8,
    });

    const next = usePetStore.getState();
    assert.equal(next.soundEnabled, false);
    assert.equal(next.backdropContrastEnabled, false);
    assert.equal(next.captionScale, 1.35);
  } finally {
    usePetStore.setState({
      soundEnabled: original.soundEnabled,
      backdropContrastEnabled: original.backdropContrastEnabled,
      captionScale: original.captionScale,
    });
  }
});
