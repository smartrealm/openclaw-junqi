import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectDingTalkTools,
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
