import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidJunQiPin, normalizeJunQiPin } from './pinPolicy';

test('JunQi PIN accepts only four to six ASCII digits', () => {
  assert.equal(isValidJunQiPin('1234'), true);
  assert.equal(isValidJunQiPin('12345'), true);
  assert.equal(isValidJunQiPin('123456'), true);
  assert.equal(isValidJunQiPin('123'), false);
  assert.equal(isValidJunQiPin('1234567'), false);
  assert.equal(isValidJunQiPin('12a4'), false);
});

test('JunQi PIN input removes non-digits and remains bounded', () => {
  assert.equal(normalizeJunQiPin('12a 34'), '1234');
  assert.equal(normalizeJunQiPin('123456789'), '123456');
});
