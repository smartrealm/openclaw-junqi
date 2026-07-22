import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildAgentShareMetadata,
  buildImportedAgentConfigEntry,
  readImportedAgentShareMetadata,
} from './agentShareDefinition';

test('agent share metadata keeps portable configuration and drops local paths and credentials', () => {
  const metadata = buildAgentShareMetadata({
    id: 'researcher',
    name: 'Researcher',
    definition: {
      id: 'researcher',
      name: 'Researcher',
      workspace: '/Users/wei/.openclaw/workspace-researcher',
      agentDir: '/Users/wei/.openclaw/agents/researcher',
      model: { primary: 'openai/gpt-4o', fallbacks: ['qwen/qwen3.6-plus'] },
      skills: ['browser', 'research'],
      sandbox: { mode: 'all', apiKey: 'must-not-export' },
      tools: { deny: ['exec'], authToken: 'must-not-export' },
    },
  });

  assert.deepEqual(metadata.definition.model, {
    primary: 'openai/gpt-4o',
    fallbacks: ['qwen/qwen3.6-plus'],
  });
  assert.deepEqual(metadata.definition.skills, ['browser', 'research']);
  assert.deepEqual(metadata.definition.sandbox, { mode: 'all' });
  assert.deepEqual(metadata.definition.tools, { deny: ['exec'] });
  assert.equal('workspace' in metadata.definition, false);
  assert.equal('agentDir' in metadata.definition, false);
});

test('imported agent definitions retain fallback configuration and use the importer-selected workspace', () => {
  const agent = readImportedAgentShareMetadata({
    agent: {
      id: 'researcher',
      name: 'Researcher',
      definition: {
        model: { primary: 'openai/gpt-4o', fallbacks: ['qwen/qwen3.6-plus'] },
        skills: ['browser'],
        workspace: '/source-machine/workspace',
      },
    },
  });

  assert.ok(agent);
  assert.deepEqual(buildImportedAgentConfigEntry(agent, '/target/workspace'), {
    id: 'researcher',
    name: 'Researcher',
    model: { primary: 'openai/gpt-4o', fallbacks: ['qwen/qwen3.6-plus'] },
    skills: ['browser'],
    workspace: '/target/workspace',
  });
});

test('legacy packages with a top-level model field remain importable', () => {
  const agent = readImportedAgentShareMetadata({
    agent: { id: 'legacy', name: 'Legacy', model: 'openai/gpt-4o' },
  });

  assert.equal(agent?.definition.model, 'openai/gpt-4o');
});

test('Agent Hub restores imported definitions with a guarded agents.list config patch', async () => {
  const source = await readFile(new URL('./index.tsx', import.meta.url), 'utf8');

  assert.match(source, /buildAgentShareMetadata\(/);
  assert.match(source, /buildImportedAgentConfigEntry\(imported, targetPath\)/);
  assert.match(source, /gateway\.callPrivileged\('config\.patch'/);
  assert.match(source, /replacePaths: \['agents\.list'\]/);
  assert.match(source, /baseHash: snap\.baseHash \?\? snap\.hash/);
});
