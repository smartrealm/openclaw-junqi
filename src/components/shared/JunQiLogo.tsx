import type { CSSProperties } from 'react';
import clsx from 'clsx';
import emblemUrl from '@/assets/brand/daxia-group-emblem.png';
import lightLogoUrl from '@/assets/brand/daxia-group-light.png';
import darkLogoUrl from '@/assets/brand/daxia-group-dark.png';

type JunQiLogoVariant = 'full' | 'emblem' | 'lockup' | 'company-emblem';

interface JunQiLogoProps {
  variant?: JunQiLogoVariant;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const BRAND_TITLE = '陕西浚启智境科技有限公司';

function DaxiaEmblem({ className, style, title }: Omit<JunQiLogoProps, 'variant'>) {
  return (
    <span
      role="img"
      aria-label={title}
      data-brand="daxia-group"
      className={clsx('relative block shrink-0 overflow-hidden', className)}
      style={style}
    >
      <img
        src={emblemUrl}
        alt=""
        aria-hidden="true"
        className="absolute left-1/2 top-1.5 block h-auto w-[190%] max-w-none -translate-x-1/2"
        draggable={false}
      />
    </span>
  );
}

export function JunQiLogo({ variant = 'full', className, style, title = BRAND_TITLE }: JunQiLogoProps) {
  if (variant === 'emblem') {
    return <DaxiaEmblem className={className} style={style} title={title} />;
  }

  if (variant === 'company-emblem') {
    return <DaxiaEmblem className={className} style={style} title={title} />;
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
