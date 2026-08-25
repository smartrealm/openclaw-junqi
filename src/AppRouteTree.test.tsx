import assert from 'node:assert/strict';
import test from 'node:test';
import { Children, isValidElement, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getFirstEnabledAppPath } from '@/config/edition';
import AppRouteTree, { UnknownAppRouteFallback } from './AppRouteTree';

function collectRoutePaths(node: ReactNode): string[] {
  if (!isValidElement<{ path?: string; children?: ReactNode }>(node)) return [];
  const ownPath = typeof node.props.path === 'string' ? [node.props.path] : [];
  return [
    ...ownPath,
    ...Children.toArray(node.props.children).flatMap(collectRoutePaths),
  ];
}

test('unknown application routes recover through the established edition fallback', () => {
  const element = UnknownAppRouteFallback();
  assert.equal(element.type, Navigate);
  assert.equal(element.props.to, getFirstEnabledAppPath());
  assert.equal(element.props.replace, true);
});

test('多智能体状态只保留智能体中心入口，不再注册独立监控页', () => {
  const paths = collectRoutePaths(AppRouteTree());

  assert.equal(paths.includes('/agents'), true);
  assert.equal(paths.includes('/agents/live'), false);
});
