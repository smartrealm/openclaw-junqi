import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawAuthLoginCommand, providerProbeProfileKey } from './providerAuthFlow';

test('BUG-MP-01 builds the official browser OAuth command without shell quoting', () => {
  assert.equal(buildOpenClawAuthLoginCommand({
    providerId: 'openai',
    profileId: 'openai:main',
    mode: 'oauth_browser',
  }), 'openclaw models auth login --provider openai --profile-id openai:main\n');
});

test('BUG-MP-01 uses the official device-code switch', () => {
  assert.equal(buildOpenClawAuthLoginCommand({
    providerId: 'minimax-portal',
    profileId: 'minimax-portal:main',
    mode: 'oauth_device',
  }), 'openclaw models auth login --provider minimax-portal --profile-id minimax-portal:main --device-code\n');
});

test('BUG-MP-01 uses the dedicated GitHub Copilot flow and rejects injection', () => {
  assert.equal(buildOpenClawAuthLoginCommand({
    providerId: 'github-copilot',
    profileId: 'ignored',
    mode: 'oauth_browser',
  }), 'openclaw models auth login-github-copilot\n');
  assert.throws(() => buildOpenClawAuthLoginCommand({
    providerId: 'openai;whoami',
    profileId: 'openai:main',
    mode: 'oauth_browser',
  }), /unsupported characters/);
});

test('BUG-MP-03 local providers probe without a nonexistent auth profile', () => {
  assert.equal(providerProbeProfileKey('local', 'ollama:main'), undefined);
  assert.equal(providerProbeProfileKey('api_key', 'openai:main'), 'openai:main');
});
