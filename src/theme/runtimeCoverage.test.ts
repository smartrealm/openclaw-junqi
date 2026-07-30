import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('every desktop window root owns a live system-theme runtime', () => {
  assert.match(source('../App.tsx'), /function ThemeRuntime\(\) \{\s*useTheme\(\)/);
  assert.match(source('../dynamic-island/DynamicIsland.tsx'), /function DynamicIsland\(\) \{\s*useTheme\(\)/);
  assert.match(source('../pages/QuickChatRoot.tsx'), /function QuickChatRoot\(\) \{\s*useTheme\(\)/);
  assert.match(source('../pages/TerminalPage/index.tsx'), /const resolvedTheme = useTheme\(\)/);
  assert.match(source('../pet/PetWindow.tsx'), /const systemPrefersDark = usePrefersDark\(\)/);
});

test('system intent reaches native theme application instead of only the resolved color', () => {
  assert.match(source('./useTheme.ts'), /applyTheme\(resolved, setting\)/);
  assert.match(source('../stores/settingsStore.ts'), /applyTheme\(resolvedTheme, theme\)/);
  assert.match(source('../pet/PetWindow.tsx'), /applyTheme\(resolveTheme\(setting, systemTheme\), setting\)/);
});
