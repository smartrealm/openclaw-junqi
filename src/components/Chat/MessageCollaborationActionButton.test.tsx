import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageCollaborationActionButton } from './MessageCollaborationActionButton';

test('message collaboration action is visibly distinct from transcript forking', () => {
  const ready = renderToStaticMarkup(
    <MessageCollaborationActionButton state="ready" onClick={() => undefined} />,
  );
  const active = renderToStaticMarkup(
    <MessageCollaborationActionButton state="active" onClick={() => undefined} />,
  );
  const confirming = renderToStaticMarkup(
    <MessageCollaborationActionButton state="confirming" />,
  );

  assert.match(ready, />Start collaboration</);
  assert.match(ready, /aria-label="Start collaboration"/);
  assert.match(ready, /lucide-users-round/);
  assert.doesNotMatch(ready, /lucide-git-fork/);
  assert.match(active, />View collaboration</);
  assert.match(confirming, /disabled=""/);
  assert.match(confirming, />Confirming message identity</);
});
