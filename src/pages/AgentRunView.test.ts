import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AgentRunView.tsx', import.meta.url), 'utf8');

test('AI task terminal forwards interactive keyboard input', () => {
  assert.match(source, /attachLinuxIMEFix\(term, sendTerminalInput\)/);
  assert.match(source, /agent_send_input/);
  assert.doesNotMatch(source, /data\.length <= 3/);
});

test('AI task terminal installs Nezha terminal affordances', () => {
  assert.match(source, /attachSmartCopy\(term\)/);
  assert.match(source, /attachMacWebKitShiftInputFix\(term\)/);
  assert.match(source, /attachTerminalScrollbarAutoHide\(term, container\)/);
  assert.match(source, /loadWebglAddon\(term\)/);
});
