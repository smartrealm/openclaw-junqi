import assert from 'node:assert/strict';
import test from 'node:test';
import { Navigate } from 'react-router-dom';
import { getFirstEnabledAppPath } from '@/config/edition';
import { UnknownAppRouteFallback } from './AppRouteTree';

test('unknown application routes recover through the established edition fallback', () => {
  const element = UnknownAppRouteFallback();
  assert.equal(element.type, Navigate);
  assert.equal(element.props.to, getFirstEnabledAppPath());
  assert.equal(element.props.replace, true);
});
