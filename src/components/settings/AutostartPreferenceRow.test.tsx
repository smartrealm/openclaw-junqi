import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutostartPreferenceRow } from './AutostartPreferenceRow';

test('autostart preference row keeps the action surface stable while status loads', () => {
  const loading = renderToStaticMarkup(<AutostartPreferenceRow.Skeleton />);
  const ready = renderToStaticMarkup(
    <AutostartPreferenceRow
      title="OpenClaw"
      description="Starts after sign-in"
      actionLabel="Toggle OpenClaw autostart"
      checked={false}
      onCheckedChange={() => undefined}
    />,
  );

  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /h-6 w-11/);
  assert.match(ready, /role="switch"/);
  assert.match(ready, /aria-label="Toggle OpenClaw autostart"/);
});

test('autostart preference row disables its switch and exposes progress during an operation', () => {
  const markup = renderToStaticMarkup(
    <AutostartPreferenceRow
      title="JunQi Desktop"
      description="Starts after sign-in"
      actionLabel="Toggle JunQi Desktop autostart"
      checked
      pendingLabel="Updating startup registration"
      onCheckedChange={() => undefined}
    />,
  );

  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /Updating startup registration/);
  assert.match(markup, /disabled=""/);
});
