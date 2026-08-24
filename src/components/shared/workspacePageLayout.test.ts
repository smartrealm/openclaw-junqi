import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKSPACE_PAGE_CONTENT_CLASS_NAME,
  WORKSPACE_PAGE_FRAME_CLASS_NAME,
} from './workspacePageLayout';

test('workspace page contracts consume the available route width without a page-specific cap', () => {
  for (const className of [WORKSPACE_PAGE_FRAME_CLASS_NAME, WORKSPACE_PAGE_CONTENT_CLASS_NAME]) {
    assert.match(className, /\bw-full\b/);
    assert.match(className, /\bmin-w-0\b/);
    assert.doesNotMatch(className, /\bmax-w-/);
    assert.doesNotMatch(className, /\bmx-auto\b/);
  }
});

test('workspace page contracts share one responsive horizontal gutter', () => {
  assert.match(WORKSPACE_PAGE_FRAME_CLASS_NAME, /\bp-3\b/);
  assert.match(WORKSPACE_PAGE_CONTENT_CLASS_NAME, /\bpx-3\b/);
  assert.match(WORKSPACE_PAGE_FRAME_CLASS_NAME, /\bsm:p-5\b/);
  assert.match(WORKSPACE_PAGE_CONTENT_CLASS_NAME, /\bsm:px-5\b/);
});
