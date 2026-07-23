import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const setupFlow = source('./useSetupFlow.ts');
const setupPage = source('../pages/SetupPage.tsx');
const terminal = source('../components/setup/OfficialOnboardingTerminal.tsx');
const onboardingPty = source('../../src-tauri/src/commands/openclaw_onboarding.rs');
const onboardingCli = source('../../src-tauri/src/commands/openclaw_cli.rs');
const config = source('../../src-tauri/src/commands/config.rs');

test('first-run setup enters the official CLI before local Gateway startup', () => {
  const nativeSetup = setupFlow.slice(
    setupFlow.indexOf('const runNativeSetup = useCallback'),
    setupFlow.indexOf('const runDockerSetup = useCallback'),
  );
  assert.match(nativeSetup, /const onboardingRequired = await resolveActiveRuntimeOnboardingRequirement\(\)/);
  assert.match(nativeSetup, /if \(onboardingRequired\)[\s\S]*replaceSetupStep\("configure-openclaw"\)[\s\S]*return true/);
  assert.match(nativeSetup, /return await startGatewayAction\("native", runId\)/);
  assert.match(setupPage, /case "configure-openclaw": return <OfficialOnboardingScreen/);
});

test('the renderer gets a fixed official onboarding PTY instead of arbitrary command execution', () => {
  assert.match(onboardingPty, /build_official_onboarding_command\(\)/);
  assert.match(onboardingPty, /start_official_onboarding/);
  assert.match(onboardingPty, /write_official_onboarding/);
  assert.doesNotMatch(onboardingPty, /program:\s*String/);
  assert.match(onboardingCli, /"--no-install-daemon"/);
  assert.match(onboardingCli, /"--skip-health"/);
  assert.match(onboardingCli, /OfficialOnboardingPlan::NativeRemote/);
  assert.match(onboardingCli, /"--mode",\s*"remote"/);
  assert.match(onboardingCli, /Docker runtime only supports OpenClaw's local onboarding/);
  assert.match(onboardingCli, /"--entrypoint",\s*"node"/);
  assert.match(onboardingCli, /"dist\/index\.js"/);
  assert.match(onboardingCli, /\.chain\(official_onboarding_arguments\(plan\)\.iter\(\)\.copied\(\)\)/);
});

test('configuration readiness is backend-owned and preserves explicit remote intent', () => {
  assert.match(config, /pub async fn get_openclaw_onboarding_readiness/);
  assert.match(config, /gateway_connection_mode_from_path/);
  assert.match(config, /gateway\.mode must be explicitly set to local or remote/);
  assert.match(config, /remote_gateway_urls\(config\)/);
  assert.match(setupFlow, /getOpenclawOnboardingReadiness\(\)/);
  assert.doesNotMatch(setupFlow, /requiresOpenClawOnboarding/);
});

test('official onboarding process supervision keeps a cancellation exclusive until reaped', () => {
  assert.match(onboardingPty, /OnboardingRegistryEntry::Starting/);
  assert.match(onboardingPty, /terminate_unregistered_child/);
  assert.match(onboardingPty, /terminate_and_reap/);
  assert.match(onboardingPty, /wait_for_exit/);
  assert.match(onboardingPty, /handle\.exit_notify\.notify_waiters/);
  assert.match(onboardingPty, /terminate_windows_process_tree/);
  const stop = onboardingPty.slice(
    onboardingPty.indexOf('pub async fn stop_official_onboarding'),
    onboardingPty.indexOf('#[cfg(test)]'),
  );
  assert.match(stop, /terminate_and_reap\(&handle\)\.await/);
  assert.doesNotMatch(stop, /remove_if_current/);
  assert.match(terminal, /onCancelled/);
});

test('a failed onboarding command can only return through the safe cancellation path', () => {
  assert.match(terminal, /if \(!sessionId\) \{\s*onCancelledRef\.current\(\);\s*return;/);
  assert.match(terminal, /onClick=\{\(\) => cancelRef\.current\(\)\}/);
});
