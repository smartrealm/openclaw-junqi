import assert from 'node:assert/strict';
import test from 'node:test';
import { presentAppAutostart } from './appAutostartPresentation';

const t = ((key: string) => key) as never;

test('application autostart presentation changes independently with its enabled state', () => {
  const disabled = presentAppAutostart({ enabled: false }, t);
  const enabled = presentAppAutostart({ enabled: true }, t);

  assert.equal(disabled.title, 'setup.appAutostart.title');
  assert.equal(disabled.description, 'setup.appAutostart.disabledHint');
  assert.equal(disabled.action, 'setup.appAutostart.enable');
  assert.equal(disabled.badge, null);
  assert.equal(enabled.description, 'setup.appAutostart.enabledHint');
  assert.equal(enabled.action, 'setup.appAutostart.disable');
  assert.equal(enabled.badge, 'setup.appAutostart.enabledBadge');
});
