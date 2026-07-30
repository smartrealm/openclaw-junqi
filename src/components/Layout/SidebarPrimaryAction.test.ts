import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const primaryActionSource = readFileSync(
  new URL('./SidebarPrimaryAction.tsx', import.meta.url),
  'utf8',
);
const sidebarSource = readFileSync(new URL('./NavSidebar.tsx', import.meta.url), 'utf8');
const panelsSource = readFileSync(new URL('./NavSidebarPanels.tsx', import.meta.url), 'utf8');

test('sidebar primary actions share one themed button contract across tabs', () => {
  assert.match(primaryActionSource, /import \{ Button, type ButtonProps \} from '@\/components\/shared\/button';/);
  assert.match(primaryActionSource, /variant="soft"/);
  assert.match(primaryActionSource, /tone="primary"/);
  assert.match(primaryActionSource, /size="lg"/);
  assert.match(primaryActionSource, /fullWidth/);

  assert.match(sidebarSource, /<SidebarPrimaryAction[\s\S]*?sidebar\.newChat/);
  assert.match(panelsSource, /<SidebarPrimaryAction[\s\S]*?sidebar\.newAgent/);
  assert.match(panelsSource, /<SidebarPrimaryAction[\s\S]*?sidebar\.openTerminal/);

  assert.doesNotMatch(
    panelsSource,
    /bg-aegis-primary text-white[^\n]*(?:sidebar\.newAgent|sidebar\.openTerminal)/,
  );
});
