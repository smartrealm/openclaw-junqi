import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsSwitch } from './SettingsSwitch';

test('settings switch exposes its native and accessible state', () => {
  const enabled = renderToStaticMarkup(
    <SettingsSwitch checked label="Notifications" onCheckedChange={() => undefined} />,
  );
  const disabled = renderToStaticMarkup(
    <SettingsSwitch checked={false} disabled label="Notifications" onCheckedChange={() => undefined} />,
  );

  assert.match(enabled, /type="button"/);
  assert.match(enabled, /role="switch"/);
  assert.match(enabled, /aria-checked="true"/);
  assert.match(enabled, /aria-label="Notifications"/);
  assert.match(disabled, /disabled=""/);
  assert.match(disabled, /aria-checked="false"/);
});

test('settings switch toggles once and rejects disabled activation', () => {
  const changes: boolean[] = [];
  const active = SettingsSwitch({
    checked: false,
    label: 'Notifications',
    onCheckedChange: (checked) => changes.push(checked),
  });
  const disabled = SettingsSwitch({
    checked: true,
    disabled: true,
    label: 'Notifications',
    onCheckedChange: (checked) => changes.push(checked),
  });

  active.props.onClick();
  disabled.props.onClick();

  assert.deepEqual(changes, [true]);
});
