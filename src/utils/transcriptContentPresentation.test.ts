import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatAssistantTranscriptMarkdown,
  formatStructuredTranscriptText,
} from './transcriptContentPresentation';

test('assistant 的完整 JSON 文档格式化为 JSON 代码块并保留数字字面量', () => {
  assert.equal(
    formatAssistantTranscriptMarkdown('{"large":900719925474099312345,"nested":{"ok":true}}'),
    '```json\n{\n  "large": 900719925474099312345,\n  "nested": {\n    "ok": true\n  }\n}\n```',
  );
});

test('工具 JSON 输出只增加可读缩进，不改写内容字面量', () => {
  assert.equal(
    formatStructuredTranscriptText('[{"name":"report.json","size":12}]'),
    '[\n  {\n    "name": "report.json",\n    "size": 12\n  }\n]',
  );
});

test('不完整 JSON、普通文本和既有 Markdown 围栏保持原文路径', () => {
  assert.equal(formatStructuredTranscriptText('{"partial":true'), '{"partial":true');
  assert.equal(formatAssistantTranscriptMarkdown('普通回复'), null);
  assert.equal(formatAssistantTranscriptMarkdown('```json\n{"ok":true}\n```'), null);
});
