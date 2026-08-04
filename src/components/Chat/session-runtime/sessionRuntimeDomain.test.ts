import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  fastModeForGateway,
  canWriteThinkingLevel,
  groupSessionModels,
  modelDisplayName,
  normalizeFastMode,
  normalizeReasoningLevel,
  normalizeResponseUsage,
  normalizeTraceLevel,
  normalizeVerboseLevel,
  SESSION_FAST_MODES,
  SESSION_REASONING_LEVELS,
  SESSION_RESPONSE_USAGE_LEVELS,
  SESSION_TRACE_LEVELS,
  SESSION_VERBOSE_LEVELS,
  reasoningLevelForGateway,
  responseUsageForGateway,
  traceLevelForGateway,
  verboseLevelForGateway,
} from './sessionRuntimeDomain';

test('groupSessionModels derives providers from gateway model ids', () => {
  const groups = groupSessionModels([
    { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
    { id: 'deepseek/deepseek-reasoner', label: 'DeepSeek Reasoner' },
    { id: 'minimax/MiniMax-M2.7', label: 'MiniMax M2.7' },
    { id: 'modelstudio/private-model', label: 'Private model' },
  ]);

  assert.deepEqual(groups.map((group) => [group.providerId, group.models.length]), [
    ['deepseek', 2],
    ['minimax', 1],
    ['modelstudio', 1],
  ]);
});

test('modelDisplayName prefers catalog metadata without model-specific rules', () => {
  assert.equal(
    modelDisplayName({ id: 'provider/model', label: 'Catalog label', alias: 'Alias' }, 'provider/model'),
    'Alias',
  );
  assert.equal(modelDisplayName(undefined, 'provider/model'), 'model');
});

test('thinking writes require the latest Gateway profile instead of a client fallback list', () => {
  const levels = [{ id: 'xhigh' }, { id: 'max' }];
  assert.equal(canWriteThinkingLevel(levels, 'xhigh'), true);
  assert.equal(canWriteThinkingLevel(levels, 'high'), false);
  assert.equal(canWriteThinkingLevel(levels, null), true);
  assert.equal(canWriteThinkingLevel(null, null), false);
});

test('fast modes map exactly to the documented session override values', () => {
  assert.deepEqual(SESSION_FAST_MODES, ['inherit', 'auto', 'on', 'off']);
  assert.equal(normalizeFastMode(null), 'inherit');
  assert.equal(normalizeFastMode(undefined), 'inherit');
  assert.equal(normalizeFastMode(true), 'on');
  assert.equal(normalizeFastMode(false), 'off');
  assert.equal(normalizeFastMode('auto'), 'auto');
  assert.equal(normalizeFastMode('unsupported'), 'inherit');
  assert.equal(fastModeForGateway('inherit'), null);
  assert.equal(fastModeForGateway('auto'), 'auto');
  assert.equal(fastModeForGateway('on'), true);
  assert.equal(fastModeForGateway('off'), false);
});

test('verbose tool output maps exactly to the documented session override values', () => {
  assert.deepEqual(SESSION_VERBOSE_LEVELS, ['inherit', 'on', 'full', 'off']);
  assert.equal(normalizeVerboseLevel(null), 'inherit');
  assert.equal(normalizeVerboseLevel(undefined), 'inherit');
  assert.equal(normalizeVerboseLevel('on'), 'on');
  assert.equal(normalizeVerboseLevel('full'), 'full');
  assert.equal(normalizeVerboseLevel('off'), 'off');
  assert.equal(normalizeVerboseLevel('unexpected'), 'inherit');
  assert.equal(verboseLevelForGateway('inherit'), null);
  assert.equal(verboseLevelForGateway('on'), 'on');
  assert.equal(verboseLevelForGateway('full'), 'full');
  assert.equal(verboseLevelForGateway('off'), 'off');
});

test('plugin trace writes only documented overrides and preserves unknown Gateway values', () => {
  assert.deepEqual(SESSION_TRACE_LEVELS, ['inherit', 'on', 'off']);
  assert.equal(normalizeTraceLevel(null), 'inherit');
  assert.equal(normalizeTraceLevel(undefined), 'inherit');
  assert.equal(normalizeTraceLevel('on'), 'on');
  assert.equal(normalizeTraceLevel('off'), 'off');
  assert.equal(normalizeTraceLevel('raw'), 'unsupported');
  assert.equal(normalizeTraceLevel('unexpected'), 'unsupported');
  assert.equal(traceLevelForGateway('inherit'), null);
  assert.equal(traceLevelForGateway('on'), 'on');
  assert.equal(traceLevelForGateway('off'), 'off');
});

test('response usage preserves the session override distinction and normalizes only the documented alias', () => {
  assert.deepEqual(SESSION_RESPONSE_USAGE_LEVELS, ['inherit', 'off', 'tokens', 'full']);
  assert.equal(normalizeResponseUsage(null), 'inherit');
  assert.equal(normalizeResponseUsage(undefined), 'inherit');
  assert.equal(normalizeResponseUsage('off'), 'off');
  assert.equal(normalizeResponseUsage('tokens'), 'tokens');
  assert.equal(normalizeResponseUsage('full'), 'full');
  assert.equal(normalizeResponseUsage('on'), 'tokens');
  assert.equal(normalizeResponseUsage('unexpected'), 'unsupported');
  assert.equal(responseUsageForGateway('inherit'), null);
  assert.equal(responseUsageForGateway('off'), 'off');
  assert.equal(responseUsageForGateway('tokens'), 'tokens');
  assert.equal(responseUsageForGateway('full'), 'full');
});

test('reasoning visibility maps exactly to the documented session override values', () => {
  assert.deepEqual(SESSION_REASONING_LEVELS, ['inherit', 'on', 'off', 'stream']);
  assert.equal(normalizeReasoningLevel(null), 'inherit');
  assert.equal(normalizeReasoningLevel(undefined), 'inherit');
  assert.equal(normalizeReasoningLevel('on'), 'on');
  assert.equal(normalizeReasoningLevel('off'), 'off');
  assert.equal(normalizeReasoningLevel('stream'), 'stream');
  assert.equal(normalizeReasoningLevel('unexpected'), 'inherit');
  assert.equal(reasoningLevelForGateway('inherit'), null);
  assert.equal(reasoningLevelForGateway('on'), 'on');
  assert.equal(reasoningLevelForGateway('off'), 'off');
  assert.equal(reasoningLevelForGateway('stream'), 'stream');
});

test('session runtime picker follows the compact shared provider identity contract', () => {
  const source = readFileSync(new URL('./SessionRuntimeControl.tsx', import.meta.url), 'utf8');
  assert.match(source, /from '@\/components\/shared\/provider-identity'/);
  assert.match(source, /w-\[min\(420px,calc\(100vw-24px\)\)\]/);
  assert.match(source, /grid-cols-\[136px_minmax\(0,1fr\)\]/);
  assert.match(source, /SESSION_VERBOSE_LEVELS/);
  assert.match(source, /SESSION_TRACE_LEVELS/);
  assert.match(source, /sessionRuntimeTraceUnsupported/);
  assert.match(source, /SESSION_RESPONSE_USAGE_LEVELS/);
  assert.match(source, /sessionRuntimeResponseUsageUnsupported/);
  assert.match(source, /thinkingOptions\.map/);
  assert.match(source, /sessionRuntimeThinkingUnavailable/);
  assert.match(source, /requiresThinkingProfileRefresh/);
  assert.doesNotMatch(source, /SESSION_THINKING_LEVELS/);
  assert.doesNotMatch(source, /<span className="shrink-0">\{fastModeLabel\}<\/span>/);
  assert.doesNotMatch(source, /w-\[min\(620px/);
  assert.doesNotMatch(source, /Icon\.provider/);
});
