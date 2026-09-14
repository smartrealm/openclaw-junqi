import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { PairingScreen } from './PairingScreen';

const callbacks = {
  onApprove: async () => {},
  onOpenControlUi: async () => {},
  onRequestScopeUpgrade: async () => {},
  onPaired: () => {},
  onCancel: () => {},
};

test('scope 拒绝先提供官方管理员权限申请入口', async () => {
  await i18n.changeLanguage('zh');
  const html = renderToStaticMarkup(createElement(PairingScreen, {
    ...callbacks,
    issue: {
      kind: 'scope_denied',
      code: 'MISSING_SCOPE',
      message: 'scope denied',
      missingScope: 'operator.admin',
    },
  }));

  assert.ok(html.includes(i18n.t('pairing.requestRequiredAccess')));
});

test('Gateway 返回升级请求后改由官方控制台审批', async () => {
  await i18n.changeLanguage('zh');
  const html = renderToStaticMarkup(createElement(PairingScreen, {
    ...callbacks,
    issue: {
      kind: 'scope_denied',
      code: 'SCOPE_UPGRADE_PENDING',
      message: 'pending',
      requestId: 'upgrade-request-1',
      missingScope: 'operator.admin',
    },
  }));

  assert.ok(html.includes(i18n.t('pairing.openControlUiForApproval')));
  assert.equal(html.includes(`>${i18n.t('pairing.requestRequiredAccess')}<`), false);
});

for (const [code, messageKey] of [
  ['SCOPE_UPGRADE_REJECTED', 'pairing.scopeUpgradeRejected'],
  ['SCOPE_UPGRADE_EXPIRED', 'pairing.scopeUpgradeExpired'],
  ['SCOPE_UPGRADE_FAILED', 'pairing.scopeUpgradeFailed'],
] as const) {
  test(`${code} 显示明确终态并提供重新申请入口`, async () => {
    await i18n.changeLanguage('zh');
    const html = renderToStaticMarkup(createElement(PairingScreen, {
      ...callbacks,
      issue: {
        kind: 'scope_denied',
        code,
        message: 'terminal scope upgrade state',
        missingScope: 'operator.admin',
      },
    }));

    assert.ok(html.includes(i18n.t(messageKey)));
    assert.ok(html.includes(i18n.t('pairing.retryScopeUpgrade')));
    assert.equal(html.includes(`>${i18n.t('pairing.requestRequiredAccess')}<`), false);
  });
}
