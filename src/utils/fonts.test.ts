import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFontStack,
  filterFonts,
  getFallbackFonts,
  normalizeFontCatalog,
  normalizeFontName,
  parseFirstFontName,
  quoteFontName,
} from "./fonts";

test("font family parsing preserves quoted commas and normalizes legacy stacks", () => {
  assert.equal(parseFirstFontName('"Font, Special", monospace'), "Font, Special");
  assert.equal(parseFirstFontName("'JetBrains Mono', monospace"), "JetBrains Mono");
  assert.equal(normalizeFontName("  'PingFang SC', sans-serif  "), "PingFang SC");
  assert.equal(normalizeFontName("Unsafe\u0000Font"), "UnsafeFont");
});
test("font stacks safely quote a selected family and preserve role-specific fallbacks", () => {
  assert.equal(quoteFontName("PingFang SC"), '"PingFang SC"');
  assert.match(buildFontStack("PingFang SC", "ui"), /^"PingFang SC", system-ui/);
  assert.match(buildFontStack("JetBrains Mono", "mono"), /^"JetBrains Mono", ui-monospace/);
  assert.equal(buildFontStack("", "editor"), "");
  assert.equal(buildFontStack("Custom Code", "editor"), '"Custom Code", var(--font-mono)');
});

test("font catalogs are validated, de-duplicated, sorted, and searchable by rank", () => {
  const catalog = normalizeFontCatalog([
    " Noto Sans ",
    "Inter",
    "Inter",
    ".Hidden Font",
    42,
    null,
  ]);
  assert.deepEqual(catalog, ["Inter", "Noto Sans"]);
  assert.deepEqual(
    filterFonts(["Mono Sans", "JetBrains Mono", "Mono", "Fira Code"], "mono"),
    ["Mono", "Mono Sans", "JetBrains Mono"],
  );
});

test("font fallback catalogs are platform-specific and never empty", () => {
  assert.ok(getFallbackFonts("MacIntel").includes("SF Mono"));
  assert.ok(getFallbackFonts("Win32").includes("Cascadia Mono"));
  assert.ok(getFallbackFonts("Linux x86_64").includes("DejaVu Sans Mono"));
});
