import type { ProviderAuthMode } from '@/types/providerAuthMode';

const CLI_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isOfficialOAuthMode(mode: ProviderAuthMode): boolean {
  return mode === 'oauth_browser' || mode === 'oauth_device';
}

export function providerProbeProfileKey(
  mode: ProviderAuthMode,
  profileKey: string,
): string | undefined {
  return mode === 'local' ? undefined : profileKey;
}

export function assertOpenClawCliIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!CLI_IDENTIFIER.test(normalized)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return normalized;
}

export function buildOpenClawAuthLoginCommand(params: {
  providerId: string;
  profileId: string;
  mode: ProviderAuthMode;
}): string {
  const providerId = assertOpenClawCliIdentifier(params.providerId, 'Provider ID');
  if (!isOfficialOAuthMode(params.mode)) {
    throw new Error('The official login command is only available for OAuth modes.');
  }
  if (providerId === 'github-copilot') {
    return 'openclaw models auth login-github-copilot\n';
  }
  const profileId = assertOpenClawCliIdentifier(params.profileId, 'Profile ID');
  const deviceCode = params.mode === 'oauth_device' ? ' --device-code' : '';
  return `openclaw models auth login --provider ${providerId} --profile-id ${profileId}${deviceCode}\n`;
}
