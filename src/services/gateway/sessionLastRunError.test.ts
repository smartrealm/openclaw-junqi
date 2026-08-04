import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGatewaySessionLastRunError } from './sessionLastRunError';

test('仅投影 Gateway 给出的非空最近运行错误摘要', () => {
  assert.equal(parseGatewaySessionLastRunError(' provider timeout '), 'provider timeout');
  assert.equal(parseGatewaySessionLastRunError(''), null);
  assert.equal(parseGatewaySessionLastRunError('   '), null);
  assert.equal(parseGatewaySessionLastRunError({ message: 'timeout' }), null);
  assert.equal(parseGatewaySessionLastRunError(['timeout']), null);
});
