import type { CSSProperties } from 'react';
import clsx from 'clsx';
import emblemUrl from '@/assets/brand/daxia-group-emblem.png';
import lightLogoUrl from '@/assets/brand/daxia-group-light.png';
import darkLogoUrl from '@/assets/brand/daxia-group-dark.png';

type JunQiLogoVariant = 'full' | 'emblem' | 'lockup';

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
        data-brand="daxia-group"
        className={clsx('block object-contain', className)}
        style={style}
        draggable={false}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={title}
      data-brand="daxia-group"
      className={clsx(
        'relative block min-w-0',
        variant === 'lockup' ? 'h-8 w-full' : 'aspect-[4001/1151] w-full',
        className,
      )}
      style={style}
    >
      <img
        src={lightLogoUrl}
        alt=""
        aria-hidden="true"
        data-theme-role="light"
        className={clsx(
          'absolute inset-0 block h-full w-full object-contain dark:hidden',
          variant === 'lockup' ? 'object-left' : 'object-center',
        )}
        draggable={false}
      />
      <img
        src={darkLogoUrl}
        alt=""
        aria-hidden="true"
        data-theme-role="dark"
        className={clsx(
          'absolute inset-0 hidden h-full w-full object-contain dark:block',
          variant === 'lockup' ? 'object-left' : 'object-center',
        )}
        draggable={false}
      />
    </span>
  );
}
