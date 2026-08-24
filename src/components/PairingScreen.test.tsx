import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { PairingScreen } from './PairingScreen';

const callbacks = {
  onApprove: async () => {},
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
  assert.equal(html.includes(i18n.t('pairing.approveRequiredAccess')), false);
});

test('Gateway 返回升级请求后只批准该准确请求', async () => {
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

  assert.ok(html.includes(i18n.t('pairing.approveRequiredAccess')));
  assert.equal(html.includes(`>${i18n.t('pairing.requestRequiredAccess')}<`), false);
});
