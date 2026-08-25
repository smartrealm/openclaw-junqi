import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageCollaborationActionButton } from './MessageCollaborationActionButton';

function renderAction(state: 'confirming' | 'ready' | 'active', onClick?: () => void) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MessageCollaborationActionButton state={state} onClick={onClick} />
    </TooltipProvider>,
  );
}

test('消息协作仅在可操作时显示紧凑且独立的入口', () => {
  const ready = renderAction('ready', () => undefined);
  const active = renderAction('active', () => undefined);
  const confirming = renderAction('confirming');

  assert.match(ready, /aria-label="Start collaboration"/);
  assert.match(ready, /lucide-users-round/);
  assert.doesNotMatch(ready, /lucide-git-fork/);
  assert.doesNotMatch(ready, />Start collaboration</);
  assert.match(active, /aria-label="View collaboration"/);
  assert.match(active, /lucide-users-round/);
  assert.equal(confirming, '');
});
