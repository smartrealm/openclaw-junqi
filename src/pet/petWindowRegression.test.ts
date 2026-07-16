import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const petWindow = readFileSync(new URL('./PetWindow.tsx', import.meta.url), 'utf8');
const petCommands = readFileSync(new URL('../../src-tauri/src/commands/pet.rs', import.meta.url), 'utf8');
const petEmitter = readFileSync(new URL('./usePetStateEmitter.ts', import.meta.url), 'utf8');

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

test('backdrop contrast refreshes from events and never uses a rapid capture loop', () => {
  assert.match(petWindow, /BACKDROP_DEBOUNCE_MS = 400/);
  assert.match(petWindow, /BACKDROP_FALLBACK_REFRESH_MS = 90_000/);
  assert.match(petWindow, /subscribeTauriEvent<\{ x: number; y: number \}>\('pet-moved'/);
  assert.match(petWindow, /new Event\(BACKDROP_REFRESH_EVENT\)/);
  assert.doesNotMatch(petWindow, /setInterval\(scheduleRefresh, 1_800\)/);
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

test('setup pet status never exposes raw installer logs or error details', () => {
  const start = petEmitter.indexOf('function localizedSetupMessage');
  const end = petEmitter.indexOf('function setupStepTitleKey');
  const localizedMessage = petEmitter.slice(start, end);
  assert.doesNotMatch(localizedMessage, /setupStatusMessage/);
  assert.doesNotMatch(localizedMessage, /setupError/);
});
