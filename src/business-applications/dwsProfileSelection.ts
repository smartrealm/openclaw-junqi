export type DwsProfileReference = {
  readonly profile: string;
  readonly isCurrent: boolean;
};

export function resolveDwsExecutionProfile(
  profiles: readonly DwsProfileReference[],
  currentProfile: string | null,
  selectedProfile: string,
): string {
  const selected = selectedProfile.trim();
  if (selected && profiles.some((profile) => profile.profile === selected)) return selected;
  const current = currentProfile?.trim();
  if (current && profiles.some((profile) => profile.profile === current)) return current;
  return profiles.find((profile) => profile.isCurrent)?.profile ?? '';
}

export function resolveDwsAvatarUrl(avatarUrl: string | null): string | null {
  const normalized = avatarUrl?.trim();
  return normalized?.startsWith('https://') ? normalized : null;
}

export function resolveDwsIdentitySecondaryLabel(
  primaryLabel: string,
  candidates: readonly (string | null | undefined)[],
): string | null {
  const normalizedPrimary = primaryLabel.trim();
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized && normalized !== normalizedPrimary) return normalized;
  }
  return null;
}
