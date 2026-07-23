import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./NavSidebar.tsx', import.meta.url), 'utf8');

const themeFiles = [
  'aegis-dark.css',
  'aegis-midnight.css',
  'aegis-light.css',
  'aegis-eyecare.css',
] as const;

type Rgb = readonly [number, number, number];

function readTheme(file: string): string {
  return readFileSync(new URL(`../../styles/themes/${file}`, import.meta.url), 'utf8');
}

function rgbToken(css: string, name: string): Rgb {
  const match = css.match(new RegExp(`--aegis-${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  assert.ok(match, `missing --aegis-${name}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function colorToken(css: string, name: string): Rgb {
  const match = css.match(new RegExp(`--aegis-${name}:\\s*([^;]+)`, 'i'));
  assert.ok(match, `missing --aegis-${name}`);
  const value = match[1].trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  const hsl = /^hsl\(([\d.]+)deg\s+([\d.]+)%\s+([\d.]+)%\)$/i.exec(value);
  assert.ok(hsl, `unsupported --aegis-${name}: ${value}`);
  const hue = Number(hsl[1]) / 360;
  const saturation = Number(hsl[2]) / 100;
  const lightness = Number(hsl[3]) / 100;
  const channel = (offset: number): number => {
    const position = (offset + hue) % 1;
    const factor = saturation * Math.min(lightness, 1 - lightness);
    const normalized = lightness - factor
      * Math.max(-1, Math.min(position * 12 - 3, Math.min(9 - position * 12, 1)));
    return Math.round(normalized * 255);
  };
  return [channel(1 / 3), channel(0), channel(2 / 3)];
}

function blend(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return foreground.map((value, index) =>
    Math.round(value * alpha + background[index] * (1 - alpha))) as unknown as Rgb;
}

function luminance(color: Rgb): number {
  const [red, green, blue] = color
    .map((value) => value / 255)
    .map((value) => value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: Rgb, background: Rgb): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function translation(locale: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(locale, key)) return locale[key];
  return key.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, locale);
}

test('session state colors use theme semantic tokens without fixed palette colors', () => {
  assert.match(
    source,
    /isActive[\s\S]*?\?[\s\S]*?'text-aegis-text'[\s\S]*?:[\s\S]*?'text-aegis-primary group-hover\/session:text-aegis-text group-focus-within\/session:text-aegis-text'/,
  );
  assert.match(source, /bg-aegis-elevated[^"]*text-aegis-text-muted/);
  assert.match(source, /hover:bg-aegis-danger\/10 hover:text-aegis-danger/);
  assert.doesNotMatch(source, /hover:bg-red-|hover:text-red-|ring-red-/);
});

test('session identity anchors title and metadata while status stays on the agent badge', () => {
  assert.match(source, /grid-cols-\[28px_minmax\(0,1fr\)_auto\]/);
  assert.match(source, /row-span-2 flex h-7 w-7/);
  assert.match(source, /col-start-2 row-start-1 min-w-0 truncate text-\[13px\]/);
  assert.match(source, /col-start-2 row-start-2 min-w-0 truncate text-\[11px\]/);
  assert.match(source, /absolute -bottom-1 -right-1 flex h-3\.5 w-3\.5/);
  assert.doesNotMatch(source, /flex h-4 w-4 shrink-0 items-center justify-center/);
});

test('session state colors retain contrast across every supported theme', () => {
  for (const file of themeFiles) {
    const css = readTheme(file);
    const primary = rgbToken(css, 'primary');
    const text = rgbToken(css, 'text');
    const muted = rgbToken(css, 'text-muted');
    const success = rgbToken(css, 'success');
    const danger = rgbToken(css, 'danger');
    const surface = colorToken(css, 'surface');
    const surfaceElevated = colorToken(css, 'surface-elevated');
    const elevated = colorToken(css, 'elevated');
    const hover = colorToken(css, 'hover');

    for (const background of [surface, surfaceElevated]) {
      const activeBackground = blend(primary, background, 0.14);
      const hoverBackground = blend(hover, background, 0.35);

      assert.ok(contrast(primary, background) >= 3, `${file}: working loader`);
      assert.ok(contrast(text, hoverBackground) >= 4.5, `${file}: hovered working loader`);
      assert.ok(contrast(text, activeBackground) >= 4.5, `${file}: active working loader`);
      assert.ok(contrast(success, background) >= 3, `${file}: completion icon`);
    }

    assert.ok(contrast(muted, elevated) >= 4.5, `${file}: row action icons`);
    assert.ok(contrast(danger, elevated) >= 3, `${file}: delete action`);
  }
});

test('session state labels exist in every active product language', () => {
  const locales = ['zh', 'zh-TW', 'en'] as const;
  const keys = [
    'chat.sessionWorking',
    'chat.sessionCompleted',
    'chat.renameSession',
    'chat.deleteSession',
    'sidebar.userSessions',
    'sidebar.background.title',
    'sidebar.background.status.running',
    'sidebar.background.status.done',
    'sidebar.background.status.failed',
    'sidebar.background.status.stopped',
  ];

  for (const language of locales) {
    const locale = JSON.parse(readFileSync(
      new URL(`../../locales/${language}.json`, import.meta.url),
      'utf8',
    )) as Record<string, unknown>;

    for (const key of keys) {
      const value = translation(locale, key);
      assert.equal(typeof value, 'string', `${language}: missing ${key}`);
      assert.ok((value as string).trim().length > 0, `${language}: empty ${key}`);
    }
  }
});
