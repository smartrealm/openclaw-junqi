import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const petWindow = readFileSync(new URL('./PetWindow.tsx', import.meta.url), 'utf8');
const petCommands = readFileSync(new URL('../../src-tauri/src/commands/pet.rs', import.meta.url), 'utf8');

test('native pet dragging has an explicit completion signal on Windows', () => {
  assert.match(petCommands, /start_dragging\(\)/);
  assert.match(petCommands, /wait_for_windows_left_button_release\(\)\.await/);
  assert.match(petCommands, /GetAsyncKeyState\(VK_LBUTTON as i32\)/);
  assert.match(petCommands, /emit_to\(PET_LABEL, "pet-drag-ended"/);
  assert.match(petWindow, /subscribeTauriEvent\('pet-drag-ended', onUp\)/);
});

test('pet transparency is owned by the native window and every DOM root', () => {
  assert.match(petCommands, /background_color\(Color\(0, 0, 0, 0\)\)/);
  assert.match(petWindow, /document\.documentElement\.style\.backgroundColor = 'transparent'/);
  assert.match(petWindow, /document\.body\.style\.backgroundColor = 'transparent'/);
  assert.match(petWindow, /appRoot\.style\.backgroundColor = 'transparent'/);
});

test('drag feedback scales the character instead of the transparent window root', () => {
  assert.doesNotMatch(petWindow, /transform: dragging \? 'scale\(1\.08\)'/);
  assert.match(petWindow, /dragging=\{dragging\}/);
});

test('pomodoro status owns one icon in the bubble without a duplicate head badge', () => {
  const petBubble = readFileSync(new URL('./PetBubble.tsx', import.meta.url), 'utf8');
  assert.match(petBubble, /data-pet-pomodoro-status/);
  assert.match(petBubble, /fontVariantNumeric: 'tabular-nums'/);
  assert.doesNotMatch(petWindow, /BadgeIcon|Pomodoro badge over the character/);
});

test('a successful file drop preserves the cursor target for the swallow catch sprint', () => {
  assert.match(petWindow, /subscribeTauriEvent<string\[]>\('aegis:file-dropped'/);
  assert.match(petWindow, /preserveDropTargetUntilRef\.current = Date\.now\(\) \+ DROP_CATCH_MEMORY_MS/);
  assert.match(petWindow, /remainingCatchMs > 0/);
  assert.match(petWindow, /state\.emotion !== 'swallow' && state\.emotion !== 'rapidSwallow'/);
});
