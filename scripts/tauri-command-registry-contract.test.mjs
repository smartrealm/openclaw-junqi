import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
      ? [path]
      : [];
  });
}

function registeredTauriCommands() {
  const source = readFileSync(join(repositoryRoot, 'src-tauri/src/lib.rs'), 'utf8');
  const handler = source.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/);
  assert.ok(handler, '必须存在 Tauri command 注册表');
  return new Set(
    [...handler[1].matchAll(/(?:[A-Za-z_]\w*::)+([A-Za-z_]\w*)/g)].map((match) => match[1]),
  );
}

function directTauriInvocations() {
  const invocationPattern = /\b(?:invoke|safeInvoke)\s*(?:<[^>\n]+>)?\s*\(\s*(['"])([^'"]+)\1/g;
  const files = [
    ...sourceFiles(join(repositoryRoot, 'src')),
    ...sourceFiles(join(repositoryRoot, 'packages')),
  ];
  return files.flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(invocationPattern)].map((match) => ({
      command: match[2],
      path: relative(repositoryRoot, path),
    }));
  });
}

test('生产代码中的直接 Tauri command 调用都已在 Rust 注册', () => {
  const registered = registeredTauriCommands();
  const missing = directTauriInvocations()
    .filter(({ command }) => !registered.has(command))
    .map(({ command, path }) => `${path}: ${command}`)
    .sort();
  assert.deepEqual(missing, []);
});
