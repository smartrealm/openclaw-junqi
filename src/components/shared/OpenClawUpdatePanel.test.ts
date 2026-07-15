import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./OpenClawUpdatePanel.tsx', import.meta.url), 'utf8');

test('OpenClaw update progress has a visible determinate fill through completion', () => {
  assert.match(source, /const progressPercent = Math\.max\(0, Math\.min\(100,/);
  assert.match(source, /aria-valuenow=\{progressPercent\}/);
  assert.match(source, /width: `\$\{progressPercent\}%`/);
  assert.match(source, /backgroundColor: 'rgb\(var\(--aegis-primary\)\)'/);
});

test('OpenClaw update status uses semantic icon colors', () => {
  assert.match(source, /indicator === 'current'[\s\S]*?CheckCircle2[\s\S]*?text-aegis-success/);
  assert.match(source, /indicator === 'available'[\s\S]*?Download[\s\S]*?text-aegis-warning/);
  assert.match(source, /indicator === 'error'[\s\S]*?CircleAlert[\s\S]*?text-aegis-danger/);
  assert.match(source, /data-state=\{indicator\}/);
});
