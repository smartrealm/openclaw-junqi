import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WorkspaceChromeIconButton,
  WorkspaceSidebarHeader,
} from './WorkspaceChrome';

test('workspace chrome exposes one accessible icon button contract', () => {
  const markup = renderToStaticMarkup(
    <WorkspaceChromeIconButton label="Add workspace"><span>+</span></WorkspaceChromeIconButton>,
  );

  assert.match(markup, /aria-label="Add workspace"/);
  assert.match(markup, /title="Add workspace"/);
  assert.match(markup, /h-7 w-7/);
});

test('workspace sidebar header keeps stable full and compact dimensions', () => {
  const full = renderToStaticMarkup(
    <WorkspaceSidebarHeader eyebrow="Terminal" title="Workspaces" actions={<span>action</span>} />,
  );
  const compact = renderToStaticMarkup(
    <WorkspaceSidebarHeader compact actions={<span>action</span>} />,
  );

  assert.match(full, /h-14/);
  assert.match(full, />Terminal</);
  assert.match(full, />Workspaces</);
  assert.match(compact, /h-14/);
  assert.doesNotMatch(compact, /Workspaces/);
});
