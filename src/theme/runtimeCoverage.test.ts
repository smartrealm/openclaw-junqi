import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const concreteThemes = [
  '../styles/themes/aegis-dark.css',
  '../styles/themes/aegis-light.css',
  '../styles/themes/aegis-midnight.css',
  '../styles/themes/aegis-eyecare.css',
];

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

test('every concrete theme provides shared chrome and pet readability tokens', () => {
  const requiredTokens = [
    '--aegis-shadow-card',
    '--aegis-shadow-float',
    '--aegis-shadow-popover',
    '--aegis-scrim',
    '--aegis-pet-text-on-light',
    '--aegis-pet-text-on-dark',
    '--aegis-status-running',
    '--aegis-status-attention',
    '--aegis-status-idle',
    '--aegis-status-dormant',
    '--aegis-status-failed',
    '--aegis-status-ended',
  ];

  for (const themePath of concreteThemes) {
    const theme = source(themePath);
    for (const token of requiredTokens) {
      assert.match(theme, new RegExp(`${token.replaceAll('-', '\\-')}\\s*:`), `${themePath} is missing ${token}`);
    }
    assert.match(
      theme,
      /--aegis-scrim:\s*rgb\(var\(--aegis-shadow-color\) \/ 0\.45\);/,
      `${themePath} must derive its scrim from the theme shadow color`,
    );
  }
});
