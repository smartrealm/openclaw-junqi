import assert from 'node:assert/strict';
import test from 'node:test';
import { isBusinessGuideActive, type BusinessGuideActivationFacts } from './activation';

const verifiedFacts: BusinessGuideActivationFacts = {
  setupComplete: true,
  connected: true,
  identityVerified: true,
  configurationVerified: true,
  modelVerified: true,
};

test('business guide activates only when every current-runtime fact is verified', () => {
  assert.equal(isBusinessGuideActive(verifiedFacts), true);

  (Object.keys(verifiedFacts) as Array<keyof BusinessGuideActivationFacts>).forEach((key) => {
    assert.equal(
      isBusinessGuideActive({ ...verifiedFacts, [key]: false }),
      false,
      `${key} must fail closed`,
    );
  });
});
