import type { CSSProperties } from 'react';
import clsx from 'clsx';
import emblemUrl from '@/assets/brand/daxia-group-emblem.png';
import lightLogoUrl from '@/assets/brand/daxia-group-light.png';
import darkLogoUrl from '@/assets/brand/daxia-group-dark.png';
import companyLogoUrl from '@/assets/brand/junqi-company-logo.png';

type JunQiLogoVariant = 'full' | 'emblem' | 'lockup' | 'company-emblem';

interface JunQiLogoProps {
  variant?: JunQiLogoVariant;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const BRAND_TITLE = '大夏集团 DAXIA GROUP';

export function JunQiLogo({ variant = 'full', className, style, title = BRAND_TITLE }: JunQiLogoProps) {
  if (variant === 'emblem') {
    return (
      <img
        src={emblemUrl}
        alt={title}
        className={clsx('block object-contain', className)}
        style={style}
        draggable={false}
      />
    );
  }

  if (variant === 'lockup') {
    return (
      <img
        src={companyLogoUrl}
        alt={title}
        className={clsx('block h-full w-full object-contain object-left dark:brightness-150 dark:saturate-75', className)}
        style={style}
        draggable={false}
      />
    );
  }

  if (variant === 'company-emblem') {
    return (
      <span
        role="img"
        aria-label={title}
        className={clsx('block shrink-0 overflow-hidden', className)}
        style={style}
      >
        <img
          src={companyLogoUrl}
          alt=""
          aria-hidden="true"
          className="block h-full w-auto max-w-none object-left dark:brightness-125"
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={title}
      className={clsx(
        'relative block min-w-0',
        'aspect-[4001/1151] w-full',
        className,
      )}
      style={style}
    >
      <img
        src={lightLogoUrl}
        alt=""
        aria-hidden="true"
        className={clsx(
          'absolute inset-0 block h-full w-full object-contain dark:hidden',
          'object-center',
        )}
        draggable={false}
      />
      <img
        src={darkLogoUrl}
        alt=""
        aria-hidden="true"
        className={clsx(
          'absolute inset-0 hidden h-full w-full object-contain dark:block',
          'object-center',
        )}
        draggable={false}
      />
    </span>
  );
}
