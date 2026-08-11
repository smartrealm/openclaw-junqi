import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThinkingBubble } from './ThinkingBubble';
import { ToolCallBubble } from './ToolCallBubble';

test('完成后的上游思考内容使用可聚焦的展开按钮', () => {
  const markup = renderToStaticMarkup(<ThinkingBubble content="官方转录内容" />);

  assert.match(markup, /<button[^>]*aria-expanded="false"/);
  assert.doesNotMatch(markup, /官方转录内容/);
});

test('工具详情仅在上游提供可展示内容时允许展开', () => {
  const withoutDetails = renderToStaticMarkup(
    <ToolCallBubble tool={{ toolName: 'exec', status: 'running' }} />,
  );
  const withDetails = renderToStaticMarkup(
    <ToolCallBubble tool={{ toolName: 'exec', status: 'done', output: 'verified' }} />,
  );

  assert.match(withoutDetails, /<button[^>]*disabled=""/);
  assert.match(withDetails, /<button[^>]*aria-expanded="false"/);
  assert.doesNotMatch(withDetails, /disabled=""/);
});
