import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyGatewayAuthorizationError,
  MessageRouter,
} from './messageRouter';

test('nested OpenClaw pairing details retain the official request id', () => {
  const issue = classifyGatewayAuthorizationError({
    code: 'UNAUTHORIZED',
    message: 'pairing required',
    details: {
      code: 'PAIRING_REQUIRED',
      reason: 'scope-upgrade',
      requestId: 'request-123',
      recommendedNextStep: 'approve_pairing',
    },
  });
  assert.deepEqual(issue, {
    kind: 'pairing_required',
    code: 'PAIRING_REQUIRED',
    message: 'pairing required',
    reason: 'scope-upgrade',
    requestId: 'request-123',
    recommendedNextStep: 'approve_pairing',
  });
});

test('token mismatch and scope mismatch are not mislabeled as pairing', () => {
  assert.equal(
    classifyGatewayAuthorizationError({
      code: 'UNAUTHORIZED',
      message: 'gateway token mismatch',
      details: { code: 'AUTH_TOKEN_MISMATCH' },
    })?.kind,
    'credentials_invalid',
  );
  assert.equal(
    classifyGatewayAuthorizationError({
      code: 'UNAUTHORIZED',
      message: 'device token does not carry the requested scopes',
      details: { code: 'AUTH_SCOPE_MISMATCH' },
    })?.kind,
    'scope_denied',
  );
});

test('structured OpenClaw missing-scope details are preserved for actionable diagnostics', () => {
  const issue = classifyGatewayAuthorizationError({
    code: 'FORBIDDEN',
    message: 'forbidden',
    details: {
      code: 'MISSING_SCOPE',
      missingScope: 'operator.admin',
      requiredScopes: ['operator.read', 'operator.write', 'operator.admin'],
    },
  });
  assert.deepEqual(issue, {
    kind: 'scope_denied',
    code: 'MISSING_SCOPE',
    message: 'forbidden',
    missingScope: 'operator.admin',
    requiredScopes: ['operator.read', 'operator.write', 'operator.admin'],
  });
});

test('generic policy errors do not enter the authorization flow', () => {
  assert.equal(
    classifyGatewayAuthorizationError({ code: 'INVALID_REQUEST', message: 'policy rejected request' }),
    null,
  );
  assert.equal(classifyGatewayAuthorizationError('Gateway connection closed'), null);
  assert.equal(classifyGatewayAuthorizationError({
    code: 'UNAUTHORIZED',
    message: 'pairing required',
  }), null);
  assert.equal(classifyGatewayAuthorizationError({
    code: 'UNKNOWN',
    message: 'missing scope: operator.admin',
  }), null);
});

test('message router ignores malformed WebSocket payloads before dispatch', () => {
  const routed: string[] = [];
  const router = new MessageRouter()
    .on('event', (message) => routed.push(`event:${message.event ?? 'unknown'}`))
    .onDefault((message) => routed.push(`default:${message.type}`));

  router.route(null);
  router.route({ event: 'connect.challenge' });
  router.route(['event', 'connect.challenge']);
  router.route({ type: 'event', event: 'connect.challenge' });
  router.route({ type: 'res', id: 'request-1', ok: true });

  assert.deepEqual(routed, ['event:connect.challenge', 'default:res']);
});
