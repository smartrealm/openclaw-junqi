import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkillProposalEventsContent } from './components';

test('proposal lifecycle dialog renders only the safe event projection and paging control', () => {
  const html = renderToStaticMarkup(
    <SkillProposalEventsContent
      events={[
        {
          sequence: 8,
          type: 'evaluation_completed',
          occurredAt: '2026-08-03T01:00:00.000Z',
          actorType: 'plugin',
        },
      ]}
      loading={false}
      error={null}
      onLoadMore={() => undefined}
    />,
  );

  assert.match(html, />8</);
  assert.match(html, /Evaluation completed/);
  assert.match(html, /Plugin/);
  assert.match(html, /Load more/);
  assert.doesNotMatch(html, /quality-plugin/);
  assert.doesNotMatch(html, /do not project/);
});
