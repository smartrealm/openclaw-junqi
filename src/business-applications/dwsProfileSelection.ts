export type DwsProfileReference = {
  readonly profile: string;
  readonly isCurrent: boolean;
};

export interface DwsProfileActionState {
  readonly selected: DwsProfileReference | null;
  readonly onlyOneProfile: boolean;
  readonly canSwitch: boolean;
}

export function resolveDwsProfileActionState(
  profiles: readonly DwsProfileReference[],
  currentProfile: string | null,
  selectedProfile: string,
): DwsProfileActionState {
  const selected = profiles.find((profile) => profile.profile === selectedProfile) ?? null;
  return {
    selected,
    onlyOneProfile: profiles.length === 1,
    canSwitch: Boolean(selected && selected.profile !== currentProfile),
  };
}

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
