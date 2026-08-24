import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewSource = readFileSync(new URL('../../pages/ChatView.tsx', import.meta.url), 'utf8');
const groupSource = readFileSync(new URL('./ExecutionProcessGroup.tsx', import.meta.url), 'utf8');

test('execution expansion preserves the current virtual-list reading position', () => {
  assert.match(viewSource, /const scrollerRef = useRef<HTMLElement \| null>\(null\)/);
  assert.match(viewSource, /const preserveViewportForExecutionToggle = useCallback/);
  assert.match(viewSource, /const scrollTop = scroller\.scrollTop/);
  assert.match(viewSource, /scrollLockedRef\.current = true/);
  assert.match(viewSource, /onBeforeExpandedChange=\{preserveViewportForExecutionToggle\}/);
  assert.match(viewSource, /scrollerRef=\{\(element\) =>/);
  assert.match(groupSource, /onBeforeExpandedChange\?\.\(\);\s+setExpanded/);
});

test('initial session entry positions the hydrated history at its tail without reader-state guards', () => {
  assert.match(viewSource, /const initialHistoryTailSessionRef = useRef<string \| null>\(null\)/);
  assert.match(viewSource, /const scrollToConversationTail = useCallback/);
  assert.match(viewSource, /shouldPositionActiveSessionTail\(\{/);
  assert.match(viewSource, /timelineItemCount: timelineItems\.length/);
  assert.match(viewSource, /key=\{activeSessionKey\}/);
  assert.match(viewSource, /return scrollToConversationTail\(\{ instant: true \}\)/);
  assert.match(viewSource, /if \(scrollLockedRef\.current \|\| !atBottom\) return;\s+scrollToConversationTail\(opts\);/);
});
