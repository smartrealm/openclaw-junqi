import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const petWindow = readFileSync(new URL('./PetWindow.tsx', import.meta.url), 'utf8');
const petBubble = readFileSync(new URL('./PetBubble.tsx', import.meta.url), 'utf8');
const petCommands = readFileSync(new URL('../../src-tauri/src/commands/pet.rs', import.meta.url), 'utf8');
const petEmitter = readFileSync(new URL('./usePetStateEmitter.ts', import.meta.url), 'utf8');
const trayMenu = readFileSync(new URL('../../src-tauri/src/tray/menu.rs', import.meta.url), 'utf8');
const dragDropRuntime = readFileSync(new URL('../runtime/DragDropRuntime.tsx', import.meta.url), 'utf8');
const petBreakOverlay = readFileSync(new URL('./PetBreakOverlay.tsx', import.meta.url), 'utf8');

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

test('backdrop contrast follows pet movement through a bounded sample scheduler', () => {
  assert.match(petWindow, /BACKDROP_SAMPLE_INTERVAL_MS = 120/);
  assert.match(petWindow, /new BackdropSampleScheduler<PetBackdropReading>/);
  assert.match(petWindow, /BACKDROP_FALLBACK_REFRESH_MS = 90_000/);
  assert.match(petWindow, /subscribeTauriEvent<\{ x: number; y: number \}>\('pet-moved'/);
  assert.match(petWindow, /new Event\(BACKDROP_REFRESH_EVENT\)/);
  assert.doesNotMatch(petWindow, /BACKDROP_DEBOUNCE_MS/);
  assert.doesNotMatch(petWindow, /setInterval\(scheduleRefresh, 1_800\)/);
});

test('backdrop sampling is fully disabled when the persisted preference is off', () => {
  assert.match(petWindow, /if \(!backdropContrastEnabled\) \{\s*setBackdrop\(null\);\s*return;/);
  assert.match(petWindow, /if \(!backdropContrastEnabled\) return;\s*window\.dispatchEvent/);
});

test('pet captions adapt their text without rendering a card or border', () => {
  assert.doesNotMatch(petBubble, /backdropStyle\.(bubble|border|boxShadow)/);
  assert.doesNotMatch(petBubble, /background:\s*backdropStyle/);
});

test('drag feedback scales the character instead of the transparent window root', () => {
  assert.doesNotMatch(petWindow, /transform: dragging \? 'scale\(1\.08\)'/);
  assert.match(petWindow, /dragging=\{dragging\}/);
});

test('pomodoro status owns one icon in the bubble without a duplicate head badge', () => {
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

test('the main pet snapshot synchronizes display preferences into the independent WebView', () => {
  assert.match(petEmitter, /presentation: presentationPreferences\(\)/);
  assert.match(petWindow, /applyPresentationPreferences\(e\.payload\.presentation\)/);
  assert.match(petWindow, /setPresentationPreferences\(preferences\)/);
});

test('pet sounds are governed by the pet preference in both producer windows', () => {
  assert.match(dragDropRuntime, /usePetStore\.getState\(\)\.soundEnabled/);
  assert.match(petWindow, /playPetSfx\('munch', usePetStore\.getState\(\)\.soundEnabled\)/);
  assert.doesNotMatch(dragDropRuntime, /useSettingsStore/);
  assert.doesNotMatch(petWindow, /useSettingsStore\.getState\(\)\.soundEnabled/);
});

test('tray pet toggles use the command that emits visibility changes', () => {
  const togglePetBranch = trayMenu.slice(trayMenu.indexOf('"toggle-pet" =>'), trayMenu.indexOf('"toggle-island" =>'));
  assert.match(togglePetBranch, /toggle_pet_window\(app\)\.await/);
  assert.doesNotMatch(togglePetBranch, /win\.hide\(\)|win\.show\(\)/);
});

test('pet listener readiness requests a replayable initial snapshot', () => {
  assert.match(petWindow, /subscribeTauriEventReady<PetState>\('pet-state'/);
  assert.match(petWindow, /emitTauriEvent\('pet-ready'\)/);
  assert.match(petEmitter, /subscribeTauriEventReady\('pet-ready'/);
  assert.match(petEmitter, /snapshotRelay\.replayLatest\(\)/);
});

test('pet break fallback copy contains no sparkle pictograph', () => {
  assert.doesNotMatch(petBreakOverlay, /\u2728/u);
});
