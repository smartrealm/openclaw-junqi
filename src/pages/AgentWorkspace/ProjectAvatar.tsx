const AVATAR_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['#2563D6', '#1E4FA8'], ['#4F63D7', '#3F46A6'], ['#6D55D2', '#5540A8'],
  ['#7B4CC7', '#61369C'], ['#0891B2', '#0E6F86'], ['#0D9488', '#0F6B64'],
  ['#0B80C6', '#075E91'], ['#0A9A73', '#087354'], ['#5B6FD6', '#4250A8'],
  ['#12A4C7', '#0B7892'],
];

export function projectAvatarColors(name: string): readonly [string, string] {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function projectInitials(name: string): string {
  const normalized = name.trim() || 'W';
  const boundary = normalized.match(/[-_\s]([a-zA-Z0-9])/u)?.[1];
  return (normalized[0] + (boundary ?? normalized[1] ?? '')).toUpperCase();
}

export function ProjectAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const [from, to] = projectAvatarColors(name);
  return (
    <span
      className="flex shrink-0 items-center justify-center font-bold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: `linear-gradient(135deg, ${from}, ${to})`,
        fontSize: size * 0.36,
        boxShadow: `0 2px 5px ${from}55`,
      }}
    >
      {projectInitials(name)}
    </span>
  );
}

