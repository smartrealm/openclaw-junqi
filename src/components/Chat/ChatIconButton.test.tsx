import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatIconButton } from './ChatIconButton';

test('icon buttons expose the localized label to both tooltip fallback and assistive technology', () => {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <ChatIconButton label="查看会话变更" onClick={() => undefined}>
        <span aria-hidden="true">D</span>
      </ChatIconButton>
    </TooltipProvider>,
  );

  assert.match(markup, /aria-label="查看会话变更"/);
  assert.match(markup, /title="查看会话变更"/);
});
