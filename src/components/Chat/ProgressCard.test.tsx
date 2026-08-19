import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressCard, splitOpenClawProgressCardMarkdown } from './ProgressCard';
import type { OpenClawProgressCard } from '@/progress-card/domain';

const card: OpenClawProgressCard = {
  id: 'progress-card-main',
  sessionKey: 'agent:main:main',
  revision: 3,
  updatedAt: 100,
  markdown: '正在执行测试。',
  steps: [
    { id: 'one', step: '核对协议', status: 'completed' },
    { id: 'two', step: '执行测试', status: 'in_progress' },
  ],
};

test('官方进度卡以当前修订和步骤状态渲染到输入区伴随卡片', () => {
  const html = renderToStaticMarkup(<ProgressCard card={card} />);
  assert.match(html, /data-progress-card="true"/);
  assert.match(html, /data-progress-card-revision="3"/);
  assert.match(html, /data-progress-card-step-state="completed"/);
  assert.match(html, /data-progress-card-step-state="in_progress"/);
  assert.match(html, /正在执行测试/);
});

test('只把结构有效的官方 progress 元素投影为原生进度条', () => {
  assert.deepEqual(splitOpenClawProgressCardMarkdown(
    '开始<progress max="7" value="3"></progress>继续',
  ), [
    { kind: 'markdown', content: '开始' },
    { kind: 'progress', value: 3, maximum: 7 },
    { kind: 'markdown', content: '继续' },
  ]);
  assert.deepEqual(splitOpenClawProgressCardMarkdown(
    '<progress value="3" max="0"></progress>',
  ), [{ kind: 'markdown', content: '<progress value="3" max="0"></progress>' }]);
});
