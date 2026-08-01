import assert from 'node:assert/strict';
import test from 'node:test';
import { presentGatewayAutostart } from './gatewayAutostartPresentation';

const translations: Record<string, string> = {
  'setup.autostart.service.windows_scheduled_task': 'Windows sign-in task',
};

const t = (key: string, values?: Record<string, unknown>) => (
  values?.service ? `${key}:${values.service}` : translations[key] ?? key
);

test('autostart presentation distinguishes a registered stopped service from a running one', () => {
  const base = {
    supported: true,
    enabled: true,
    serviceKind: 'windows_scheduled_task' as const,
  };
  const waiting = presentGatewayAutostart({ ...base, running: false }, t as never);
  const running = presentGatewayAutostart({ ...base, running: true }, t as never);

  assert.equal(waiting.badge, 'setup.autostart.enabledWaitingBadge');
  assert.equal(waiting.description, 'setup.autostart.enabledWaitingHint:Windows sign-in task');
  assert.equal(running.badge, 'setup.autostart.enabledRunningBadge');
  assert.equal(running.description, 'setup.autostart.enabledRunningHint:Windows sign-in task');
});
