import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('deprecated JunQi shortcut, platform, and theme surfaces stay removed', () => {
  const shortcuts = source('src/junqi/shortcuts.ts');

  assert.doesNotMatch(shortcuts, /SendShortcut|PromptKeyEventLike|DEFAULT_SEND_SHORTCUT/);
  assert.doesNotMatch(shortcuts, /getSendShortcut|getNewlineShortcut|isHideWindowShortcut/);
  assert.doesNotMatch(shortcuts, /shouldInsertPromptNewlineKey|shouldSubmitPromptKey/);
  assert.doesNotMatch(shortcuts, /getAltEnterNewlineKeys|getShiftEnterNewlineKeys/);
  assert.match(shortcuts, /DEFAULT_SHIFT_ENTER_NEWLINE/);
  assert.match(shortcuts, /matchesTerminalNewline/);
  assert.equal(existsSync(new URL('src/junqi/platform.ts', root)), false);
  assert.equal(existsSync(new URL('src/theme/index.ts', root)), false);
});

test('terminal views use one terminal type source', () => {
  assert.equal(existsSync(new URL('src/junqi/types.ts', root)), false);
  assert.match(source('src/components/Terminal/PaneTreeView.tsx'), /\.\/terminalTypes/);
  assert.match(
    source('src/pages/TerminalPage/index.tsx'),
    /@\/components\/Terminal\/terminalTypes/,
  );
});

test('provider claim contract and live Rust agent metadata stay intact', () => {
  assert.equal(existsSync(new URL('src/workbench/provider/providerClaimClient.ts', root)), true);

  const agents = source('src-tauri/src/commands/agent_task_pty.rs');
  const providers = source('src-tauri/src/commands/workbench_provider.rs');
  assert.doesNotMatch(agents, /#\[allow\(dead_code\)\]\s+pub\(crate\) label/);
  assert.doesNotMatch(agents, /#\[allow\(dead_code\)\]\s+resume_flag/);
  assert.match(agents, /spec\.resume_flag/);
  assert.match(providers, /label: spec\.label\.to_string\(\)/);
});

test('unused Rust path and state helpers stay removed', () => {
  assert.doesNotMatch(source('src-tauri/src/paths.rs'), /pub fn devices_dir\(/);
  assert.doesNotMatch(source('src-tauri/src/commands/ensure.rs'), /_state_lookup_helper/);
});
