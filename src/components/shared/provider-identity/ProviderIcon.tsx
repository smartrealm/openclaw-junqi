import { useSyncExternalStore, type CSSProperties } from 'react';
import clsx from 'clsx';
import {
  getCustomProviderIcon,
  normalizeCustomProviderIcon,
  subscribeProviderAppearance,
} from './providerAppearance';
import {
  providerFallbackGlyph,
  resolveOfficialProviderIconName,
} from './providerIdentity';

export interface ProviderIconProps {
  providerId: string;
  size?: number;
  className?: string;
  customIcon?: string;
}

function providerIconAssetUrl(iconName: string): string {
  return `${import.meta.env.BASE_URL}provider-icons/ProviderIcon-${iconName}.svg`;
}

export function ProviderIcon({ providerId, size = 16, className, customIcon }: ProviderIconProps) {
  const storedIcon = useSyncExternalStore(
    subscribeProviderAppearance,
    () => getCustomProviderIcon(providerId),
    () => '',
  );
  const officialIcon = resolveOfficialProviderIconName(providerId);
  const resolvedCustomIcon = normalizeCustomProviderIcon(customIcon) || storedIcon;
  const sharedStyle: CSSProperties = { width: size, height: size };

  if (officialIcon) {
    const mask = `url("${providerIconAssetUrl(officialIcon)}") center / contain no-repeat`;
    return (
      <span
        aria-hidden="true"
        data-provider-icon={officialIcon}
        className={clsx('inline-block shrink-0 bg-current', className)}
        style={{ ...sharedStyle, WebkitMask: mask, mask }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      data-provider-icon="custom"
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded border border-current/35 font-semibold leading-none',
        className,
      )}
      style={{ ...sharedStyle, fontSize: Math.max(8, Math.round(size * 0.55)) }}
    >
      {resolvedCustomIcon || providerFallbackGlyph(providerId)}
    </span>
  );
}
