import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectDingTalkTools,
  hasAvailableDingTalkRuntimeTool,
  parseDingTalkBusinessEvidence,
  parseDingTalkRuntimeOutput,
  parseDingTalkToolSchemaOutput,
  parseProfileReference,
  parseToolArguments,
} from './dingtalkTools';

test('only projects effective tools owned by the DingTalk plugin', () => {
  const tools = collectDingTalkTools([{ tools: [
    {
      id: 'junqi_dingtalk_calendar_events',
      label: '日程列表',
      description: '查询日程',
      rawDescription: '查询日程',
      source: 'plugin',
      pluginId: 'junqi-dingtalk',
      risk: 'low',
      tags: ['dingtalk', 'calendar', 'read'],
    },
    {
      id: 'other_tool',
      label: '其他',
      description: '',
      rawDescription: '',
      source: 'plugin',
      pluginId: 'other-plugin',
    },
  ] }]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.domain, 'calendar');
  assert.equal(tools[0]?.effect, 'read');
});

test('仅在当前 Session 明确提供且未拒绝钉钉运行时工具时确认授权生效', () => {
  const runtimeTool = {
    id: 'junqi_dingtalk_runtime_status',
    label: '钉钉运行状态',
    description: '读取运行状态',
    rawDescription: '读取运行状态',
    source: 'plugin' as const,
    pluginId: 'junqi-dingtalk',
  };
  assert.equal(hasAvailableDingTalkRuntimeTool([{ tools: [runtimeTool] }]), true);
  assert.equal(hasAvailableDingTalkRuntimeTool([{ tools: [{ ...runtimeTool, deniedBySession: true }] }]), false);
  assert.equal(hasAvailableDingTalkRuntimeTool([{ tools: [{ ...runtimeTool, pluginId: 'other-plugin' }] }]), false);
});

test('projects the official tools.invoke AgentToolResult details', () => {
  const schema = parseDingTalkToolSchemaOutput({
    content: [{ type: 'text', text: '{}' }],
    details: {
      dwsCanonicalPath: 'contact.search_contact_by_key_word',
      schemaDigest: 'a'.repeat(64),
      parameters: {
        query: { type: 'string', required: true },
      },
    },
  });
  assert.equal(schema.canonicalPath, 'contact.search_contact_by_key_word');
  assert.equal(schema.parameters[0]?.name, 'query');
  assert.equal(schema.parameters[0]?.required, true);
});

test('requires exact profile references and object arguments', () => {
  assert.equal(parseProfileReference('corp-a:user-b'), 'corp-a:user-b');
  assert.equal(parseProfileReference('corp-a'), null);
  assert.deepEqual(parseToolArguments('{"query":"研发"}'), { query: '研发' });
  assert.throws(() => parseToolArguments('[]'), /JSON 对象/);
});

test('projects DWS login user and authorization status without accepting unsafe avatar URLs', () => {
  const runtime = parseDingTalkRuntimeOutput({ output: { details: { runtime: {
    currentProfile: 'corp-a:user-a',
    profiles: [{ profile: 'corp-a:user-a', corpName: '示例组织', userName: '张三', status: 'active', authorizedDomains: ['contact'], isCurrent: true }],
    currentUser: { name: '张三', userId: 'user-a', organization: '示例组织', department: '产品部', avatarUrl: 'http://invalid.example/avatar.png' },
  } } } });
  assert.equal(runtime.user?.name, '张三');
  assert.equal(runtime.available, false);
  assert.equal(runtime.user?.avatarUrl, null);
  assert.deepEqual(runtime.profiles[0]?.authorizedDomains, ['contact']);
});

test('projects DWS runtime absence as a verified unavailable state', () => {
  const runtime = parseDingTalkRuntimeOutput({ output: { details: { runtime: {
    available: false,
    runtimeError: { code: 'DWS_RUNTIME_NOT_FOUND', message: 'DWS executable was not found in PATH' },
    profiles: [],
    currentProfile: null,
    currentUser: null,
  } } } });
  assert.equal(runtime.available, false);
  assert.equal(runtime.runtimeError?.code, 'DWS_RUNTIME_NOT_FOUND');
  assert.equal(runtime.runtimeError?.message, 'DWS executable was not found in PATH');
});

test('projects only DWS evidence metadata from a business result', () => {
  const evidence = parseDingTalkBusinessEvidence({ output: { details: {
    dwsCanonicalPath: 'contact.user.get_self',
    schemaDigest: 'a'.repeat(64),
    recoveryEventId: 'recovery-a',
    data: { mobile: '13800000000' },
  } } });
  assert.deepEqual(evidence, {
    dwsCanonicalPath: 'contact.user.get_self',
    schemaDigest: 'a'.repeat(64),
    recoveryEventId: 'recovery-a',
  });
});
