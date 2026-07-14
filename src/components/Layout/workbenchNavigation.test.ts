import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('model service is a single navigation action without an inline add button', async () => {
  const source = await read('./NavSidebar.tsx');
  const workbench = source.slice(
    source.indexOf('function WorkbenchPanel'),
    source.indexOf('// Panel Registry'),
  );

  assert.match(workbench, /sidebar\.nav\.models/);
  assert.doesNotMatch(workbench, /config\?tab=providers&action=add/);
  assert.doesNotMatch(workbench, /it\.key === 'models'/);
});

test('scheduled tasks opens the maintenance list instead of forcing create mode', async () => {
  const source = await read('./NavSidebar.tsx');
  const workbench = source.slice(
    source.indexOf('function WorkbenchPanel'),
    source.indexOf('// Panel Registry'),
  );

  assert.match(workbench, /key: 'cron',\s+to: '\/cron'/);
  assert.doesNotMatch(workbench, /\/cron\?new=1/);
});
