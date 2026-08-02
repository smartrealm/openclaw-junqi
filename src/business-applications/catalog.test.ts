import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSINESS_INTEGRATION_CATALOG, findBusinessIntegration } from './catalog';

test('business integration catalog uses stable unique ids and capabilities', () => {
  const ids = BUSINESS_INTEGRATION_CATALOG.map((integration) => integration.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const integration of BUSINESS_INTEGRATION_CATALOG) {
    assert.ok(integration.icon);
    assert.ok(integration.nameKey.startsWith('businessApplications.'));
    assert.ok(integration.prerequisitesKey.startsWith('businessApplications.'));
    assert.ok(integration.capabilities.length > 0);
    assert.equal(new Set(integration.capabilities.map((capability) => capability.id)).size, integration.capabilities.length);
  }
});

test('unknown business integration resolves to the first registered descriptor', () => {
  assert.equal(findBusinessIntegration('unknown').id, BUSINESS_INTEGRATION_CATALOG[0]!.id);
});
