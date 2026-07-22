import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTerminalProxyUnsetInput } from './terminalStatusActions';

test('proxy unset clears both proxy casing variants in POSIX shells', () => {
  assert.equal(
    buildTerminalProxyUnsetInput('https_proxy=http://127.0.0.1:7890', 'posix'),
    'unset https_proxy HTTPS_PROXY\r',
  );
});

test('proxy unset uses PowerShell environment semantics on Windows', () => {
  assert.equal(
    buildTerminalProxyUnsetInput('HTTP_PROXY=http://127.0.0.1:7890', 'powershell'),
    '$env:HTTP_PROXY = $null; $env:HTTP_PROXY = $null\r',
  );
});

test('proxy unset rejects malformed or injectable environment names', () => {
  assert.equal(buildTerminalProxyUnsetInput('HTTP_PROXY', 'posix'), null);
  assert.equal(buildTerminalProxyUnsetInput('HTTP_PROXY; rm -rf /=value', 'posix'), null);
  assert.equal(buildTerminalProxyUnsetInput('=value', 'posix'), null);
});
