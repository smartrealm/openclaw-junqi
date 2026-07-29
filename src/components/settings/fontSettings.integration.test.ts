import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("active settings expose separate interface, editor, and terminal font controls", () => {
  const settingsPage = source("../../pages/SettingsPage.tsx");
  const terminalSettings = source("./TerminalSettingsPanel.tsx");
  const fontPanel = source("./FontPanel.tsx");

  assert.match(settingsPage, /<FontPanel[\s\S]*uiFont=\{uiFont\}[\s\S]*editorFont=\{editorFont\}/);
  assert.match(fontPanel, /role="ui"/);
  assert.match(fontPanel, /role="editor"/);
  assert.match(terminalSettings, /<FontSelector[\s\S]*role="mono"/);
  assert.doesNotMatch(terminalSettings, /MONO_FONT_OPTIONS/);
});

test("font preferences restore before paint and editor font follows terminal by default", () => {
  const store = source("../../stores/settingsStore.ts");
  const bootstrap = source("../../theme/earlyBootstrap.ts");
  const styles = source("../../styles/index.css");
  const editorTheme = source("../../utils/codeMirrorTheme.ts");

  assert.match(store, /editorFont: buildFontStack/);
  assert.match(store, /setProperty\('--font-sans', next\)/);
  assert.match(bootstrap, /AEGIS_FONTS_STORAGE_KEYS\.editorFont/);
  assert.match(bootstrap, /setProperty\('--font-sans', stack\)/);
  assert.match(styles, /--font-editor: var\(--font-mono\)/);
  assert.match(editorTheme, /fontFamily: 'var\(--font-editor, var\(--font-mono\)\)'/);
});

test("font selector loads lazily, supports keyboard selection, and virtualizes the catalog", () => {
  const selector = source("./FontSelector.tsx");

  assert.match(selector, /loadSystemFontCatalog\(\)/);
  assert.match(selector, /event\.key === "ArrowDown"/);
  assert.match(selector, /event\.key === "Enter"/);
  assert.match(selector, /options\.slice\(startIndex, endIndex\)/);
  assert.match(selector, /catalogSource === "fallback"/);
});

test("font settings translations exist in every supported locale", () => {
  const localeNames = ["zh", "zh-TW", "en"];
  const keys = [
    "title",
    "fallback",
    "clear",
    "showFonts",
    "uiFont",
    "uiFontHint",
    "editorFont",
    "editorFontHint",
    "junqiDefault",
    "followTerminal",
  ];

  for (const localeName of localeNames) {
    const locale = JSON.parse(source(`../../locales/${localeName}.json`)) as {
      font?: Record<string, unknown>;
    };
    for (const key of keys) {
      assert.equal(typeof locale.font?.[key], "string", `${localeName} is missing font.${key}`);
      assert.notEqual(String(locale.font?.[key]).trim(), "", `${localeName} has empty font.${key}`);
    }
  }
});
