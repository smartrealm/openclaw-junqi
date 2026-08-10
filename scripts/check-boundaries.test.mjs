import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import {
  MODULE_BOUNDARY_RULES,
  extractGatewayLifecycleBypasses,
  extractModuleImports,
  scanModuleBoundaries,
} from './check-boundaries.mjs';

function scan(path, content) {
  return scanModuleBoundaries([{ path, content }]);
}

describe('模块边界生产扫描器', () => {
  test('规则矩阵覆盖主题、服务、组件和页面', () => {
    assert.equal(MODULE_BOUNDARY_RULES.some((rule) => rule.pattern.test('theme/colors.ts')), true);
    assert.equal(MODULE_BOUNDARY_RULES.some((rule) => rule.pattern.test('services/gateway.ts')), true);
    assert.equal(MODULE_BOUNDARY_RULES.some((rule) => rule.pattern.test('components/Foo.tsx')), true);
    assert.equal(MODULE_BOUNDARY_RULES.some((rule) => rule.pattern.test('pages/Foo.tsx')), true);
  });

  test('静态、类型和动态导入使用同一提取逻辑', () => {
    assert.deepEqual(extractModuleImports(`
      import type { One } from '@/stores/one';
      import { Two } from '@/services/two';
      const three = import('@/components/three');
    `), [
      { specifier: '@/stores/one', typeOnly: true },
      { specifier: '@/services/two', typeOnly: false },
      { specifier: '@/components/three', typeOnly: false },
    ]);
  });

  test('别名和跨目录相对导入都会按真实目标命中', () => {
    assert.equal(scan('services/one.ts', `import { store } from '@/stores/one';`).length, 1);
    assert.equal(scan('services/nested/one.ts', `import { store } from '../../stores/one';`).length, 1);
    assert.equal(scan('components/Foo.tsx', `const gateway = import('@/services/gateway');`).length, 1);
  });

  test('组件可以消费服务类型但不能形成运行时服务依赖', () => {
    assert.equal(scan('components/Foo.tsx', `import type { Result } from '@/services/result';`).length, 0);
    assert.equal(scan('components/Foo.tsx', `import { result } from '@/services/result';`).length, 1);
  });

  test('主题桥接文件只允许设置仓库', () => {
    assert.equal(scan('theme/useTheme.ts', `import { settings } from '@/stores/settingsStore';`).length, 0);
    assert.equal(scan('theme/useTheme.ts', `import { gateway } from '@/services/gateway';`).length, 1);
  });

  test('页面拒绝 Tauri core 和直接 invoke', () => {
    assert.equal(scan('pages/Foo.tsx', `import { invoke } from '@tauri-apps/api/core';`).length, 1);
    assert.equal(scan('pages/Foo.tsx', `void invoke('unsafe');`).length, 1);
  });

  test('普通 Gateway 生命周期不能绕过统一协调器', () => {
    assert.deepEqual(extractGatewayLifecycleBypasses(`
      import { restartGateway as restart } from '@/api/tauri-commands';
      import { gatewayManager as manager } from '@/services/gateway/GatewayConnectionManager';
      void restart();
      manager.reconnect();
    `), ['restartGateway', 'reconnect']);
    assert.equal(scan('pages/Foo.tsx', `
      import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
      gatewayManager.restart();
    `).length, 1);
    assert.equal(scan('services/gateway/gatewayProcessObservation.ts', `
      import { restartGateway } from '@/api/tauri-commands';
      void restartGateway();
    `).length, 0);
    assert.equal(scan('hooks/useSetupFlow/useWizardSession.ts', `
      import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
      gatewayManager.reconnect();
    `).length, 0);
  });

  test('同层和外部包导入保持允许', () => {
    assert.equal(scan('services/one.ts', `import { two } from './two';`).length, 0);
    assert.equal(scan('components/Foo.tsx', `import { useState } from 'react';`).length, 0);
  });

  test('真实仓库扫描结果由生产脚本决定', () => {
    const result = spawnSync('node', ['scripts/check-boundaries.mjs'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Module boundaries clean/);
  });
});
