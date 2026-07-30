import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = fileURLToPath(new URL('../', import.meta.url));

/**
 * Hex colors are valid only where color is the content itself or where a
 * pre-theme bootstrap/fatal surface cannot consume application tokens.
 * Product chrome must use --aegis-* semantic tokens.
 */
// Exact reviewed occurrence budgets. Unlike a file-only allowlist this rejects
// adding another literal to a mixed content/chrome file; changing the budget
// requires reviewing the actual diff and its semantic justification.
const REVIEWED_HEX_OCCURRENCES: Readonly<Record<string, number>> = {
  'components/Chat/MessageBubble.tsx': 1, // sandboxed HTML preview paper
  'components/FileExplorer/fileViewerCapabilities.ts': 15, // language/file identity palette
  'components/Git/DiffFileBlock.tsx': 4, // diff semantic palette
  'components/Git/GitDiffViewer.tsx': 2,
  'components/Git/GitFileBrowser.tsx': 2,
  'components/Git/GitHistory.tsx': 2,
  'components/Git/types.ts': 7,
  'components/Terminal/PaneSearchBar.tsx': 7, // xterm search decoration contract
  'components/Terminal/terminalShared.ts': 24, // xterm ANSI palette and fallback contract
  'components/settings/ThemePicker.tsx': 11, // renders theme swatches and preview canvases
  'pages/AgentRunView.tsx': 2, // xterm fallback palette
  'pages/OpenClawCommands/commands-core.ts': 1, // URL fragment syntax, not a color
  'pages/SetupPage/WizardScreen.tsx': 2, // generated QR bitmap foreground/background
  'pages/SetupPage/shared.tsx': 10, // renders theme swatches
  'pet/PetBubble.tsx': 1,
  'pet/PetCharacter.tsx': 3,
  'pet/backdropContrast.ts': 2,
  'pet/effects.tsx': 1,
  'pet/petTheme.ts': 73,
  'pet/pomodoroView.ts': 4,
  'pet/skins/index.tsx': 13, // mascot artwork palette
  'runtime/fatalErrorOverlay.ts': 3, // pre-React emergency surface
  'styles/index.css': 6, // CSS mask sentinel colors; not rendered chrome
  'styles/primitives.css': 10, // fixed data-visualization primitives
  'styles/terminal-kooky.css': 28, // terminal/ANSI theme definition
  'styles/terminal.css': 18, // terminal/ANSI theme definition
  'styles/themes/aegis-dark.css': 30,
  'styles/themes/aegis-eyecare.css': 30,
  'styles/themes/aegis-light.css': 24,
  'styles/themes/aegis-midnight.css': 33, // semantic token definitions
  'utils/theme-colors.ts': 1, // token conversion fallback and documentation
  'workbench/components/WorkbenchTerminalPane.tsx': 3, // isolated xterm palette
};

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (['.ts', '.tsx', '.css'].includes(extname(entry.name)) && !entry.name.includes('.test.')) result.push(path);
    }
  };
  walk(root);
  return result;
}

function executableSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('BUG-FCA-08 product chrome does not introduce unclassified hex colors', () => {
  const files = sourceFiles(srcRoot)
    .map((path) => ({ path, relativePath: relative(srcRoot, path) }));
  const offenders: string[] = [];
  const reviewedPaths = new Set(Object.keys(REVIEWED_HEX_OCCURRENCES));

  for (const { path, relativePath } of files) {
    const source = executableSource(readFileSync(path, 'utf8'));
    const count = source.match(/#[0-9a-fA-F]{3,8}\b/g)?.length ?? 0;
    const reviewedCount = REVIEWED_HEX_OCCURRENCES[relativePath];
    if (reviewedCount === undefined) {
      if (count > 0) offenders.push(`${relativePath}: ${count} unclassified`);
      continue;
    }
    reviewedPaths.delete(relativePath);
    if (count !== reviewedCount) {
      offenders.push(`${relativePath}: expected ${reviewedCount}, found ${count}`);
    }
  }

  for (const stalePath of reviewedPaths) offenders.push(`${stalePath}: stale review entry`);
  assert.deepEqual(
    offenders,
    [],
    `Replace product chrome colors with semantic tokens or review the exact content-color budget: ${offenders.join(', ')}`,
  );
});
