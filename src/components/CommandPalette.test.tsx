import '../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LayoutDashboard } from 'lucide-react';
import { CommandPaletteIcon } from './CommandPalette';

test('command palette renders forwardRef Lucide icons as components', () => {
  const html = renderToStaticMarkup(
    <CommandPaletteIcon icon={LayoutDashboard} selected />,
  );

  assert.match(html, /lucide-layout-dashboard/);
  assert.match(html, /text-aegis-primary/);
});
