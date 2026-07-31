import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const CHAT_SOURCE_ROOT = resolve(process.cwd(), 'src/components/Chat');
const LANGUAGE_NAMES = ['en', 'zh', 'zh-TW'] as const;

type TranslationCatalog = Record<string, unknown>;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
    })
    .sort();
}

function staticTranslationKeys(): string[] {
  const keys = new Set<string>();
  const pattern = /\b(?:t|text)\(\s*['"]([A-Za-z][\w-]*(?:\.[\w-]+)+)['"]/g;
  const fileCardMetaPattern = /['"](resultCards\.fileMeta\.[\w-]+)['"]/g;

  for (const file of sourceFiles(CHAT_SOURCE_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) keys.add(match[1]);
    for (const match of source.matchAll(fileCardMetaPattern)) keys.add(match[1]);
  }

  return [...keys].sort();
}

function translationValue(catalog: TranslationCatalog, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(catalog, key)) return catalog[key];

  return key.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null) return undefined;
    const record = value as TranslationCatalog;
    return Object.prototype.hasOwnProperty.call(record, segment) ? record[segment] : undefined;
  }, catalog);
}

function staticTranslationFallbacks(): string[] {
  const keys = new Set<string>();

  for (const file of sourceFiles(CHAT_SOURCE_ROOT)) {
    const source = readFileSync(file, 'utf8');
    const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 't'
        && node.arguments.length >= 2
        && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
        && /^[A-Za-z][\w-]*(?:\.[\w-]+)+$/.test(node.arguments[0].text)
      ) {
        const fallback = node.arguments[1];
        const hasLiteralFallback = ts.isStringLiteral(fallback) || ts.isNoSubstitutionTemplateLiteral(fallback);
        const hasDefaultValue = ts.isObjectLiteralExpression(fallback) && fallback.properties.some((property) => (
          ts.isPropertyAssignment(property)
          && ((ts.isIdentifier(property.name) && property.name.text === 'defaultValue')
            || (ts.isStringLiteral(property.name) && property.name.text === 'defaultValue'))
        ));
        if (hasLiteralFallback || hasDefaultValue) keys.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };

    visit(parsed);
  }

  return [...keys].sort();
}

test('every static Chat translation key resolves in every shipped language', () => {
  const keys = staticTranslationKeys();
  assert.ok(keys.length > 0, 'expected static Chat translation keys');

  for (const language of LANGUAGE_NAMES) {
    const catalog = JSON.parse(readFileSync(
      resolve(process.cwd(), `src/locales/${language}.json`),
      'utf8',
    )) as TranslationCatalog;
    const missing = keys.filter((key) => {
      const value = translationValue(catalog, key);
      return typeof value !== 'string' || value.trim().length === 0;
    });

    assert.deepEqual(missing, [], `${language} is missing static Chat translations`);
  }
});

test('Chat static translations do not embed display fallback text', () => {
  assert.deepEqual(staticTranslationFallbacks(), []);
});
