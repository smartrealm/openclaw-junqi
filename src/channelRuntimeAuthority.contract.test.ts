import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const CHANNEL_IDS = [
  'feishu', 'lark', 'telegram', 'discord', 'slack', 'whatsapp', 'signal',
  'imessage', 'googlechat', 'mattermost', 'msteams', 'matrix', 'line', 'zalo',
  'zalouser', 'wecom', 'wechat', 'openclaw-weixin', 'qqbot', 'nostr',
  'nextcloud-talk', 'raft', 'clickclack', 'synology-chat', 'tlon', 'twitch',
  'yuanbao',
];
const CHANNEL_LITERAL = new RegExp(`['"](?:${CHANNEL_IDS.join('|')})['"]`, 'i');

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales' || entry.name === 'business-applications') continue;
      files.push(...await sourceFiles(path));
    } else if (['.ts', '.tsx', '.rs', '.mjs', '.js'].includes(extname(entry.name))) {
      if (!entry.name.includes('.test.') && !entry.name.includes('.spec.')) files.push(path);
    }
  }
  return files;
}

function productionSource(path: string, source: string): string {
  if (extname(path) !== '.rs') return source;
  const testModule = source.indexOf('#[cfg(test)]');
  return testModule >= 0 ? source.slice(0, testModule) : source;
}

test('production channel logic contains no non-DingTalk channel-id literals', async () => {
  const roots = ['src', 'src-tauri/src', 'scripts'].map((directory) => join(ROOT, directory));
  const matches: string[] = [];
  for (const file of (await Promise.all(roots.map(sourceFiles))).flat()) {
    const source = productionSource(file, await readFile(file, 'utf8'));
    if (CHANNEL_LITERAL.test(source)) matches.push(relative(ROOT, file));
  }
  assert.deepEqual(matches, []);
});

test('removed static channel authority modules stay removed', async () => {
  const files = await sourceFiles(join(ROOT, 'src'));
  const joined = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(joined, /CHANNEL_TEMPLATES|OFFLINE_CHANNEL_CATALOG|OFFLINE_CHANNEL_IDS|CHANNEL_ORDER/);
  assert.doesNotMatch(joined, /feishuQrSetupMethod|FeishuQrWizardBridge|ALL_CHANNELS/);
});
