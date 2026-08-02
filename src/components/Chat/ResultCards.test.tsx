import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FileResultCard } from './ResultCards';

test('file output rows expose direct preview and file actions', () => {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <FileResultCard
        files={[{ path: 'report.md', kind: 'path' }]}
        workspaceRoot="/workspace"
      />
    </TooltipProvider>,
  );

  assert.match(markup, /data-file-actions="true"/);
  assert.match(markup, /data-file-action="preview"/);
  assert.match(markup, /data-file-action="open"/);
  assert.match(markup, /data-file-action="reveal"/);
  assert.match(markup, /data-file-action="copy"/);
  assert.match(markup, /aria-label="Preview"/);
  assert.match(markup, /aria-label="Copy path"/);
});
