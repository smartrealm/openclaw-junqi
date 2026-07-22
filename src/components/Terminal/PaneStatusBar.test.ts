import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./PaneStatusBar.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/terminal-kooky.css', import.meta.url), 'utf8');

test('tool-call pill uses rendered measurements rather than pane-wide width thresholds', () => {
  assert.match(source, /selectTerminalToolCallPillVariant\(measurements\)/);
  assert.match(source, /fullMeasureRef/);
  assert.match(source, /identifierMeasureRef/);
  assert.doesNotMatch(source, /availableWidth !== null && availableWidth < 240/);
  assert.doesNotMatch(source, /availableWidth !== null && availableWidth < 400/);
});

test('tool-call full variant is not capped while compact identifier remains bounded', () => {
  const pillRule = css.match(/\.terminal-kooky-tool-call-pill \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(pillRule, /max-width:\s*260px/);
  assert.match(source, /variant === 'identifier' \? ' terminal-kooky-tool-call-identifier--compact' : ''/);
  assert.match(css, /\.terminal-kooky-tool-call-identifier--compact \{[\s\S]*?max-width:\s*200px/);
});
