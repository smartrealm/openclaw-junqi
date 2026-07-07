import type { CSSProperties } from 'react';
import clsx from 'clsx';
import emblemUrl from '@/assets/brand/junqi-emblem.svg';
import fullLogoUrl from '@/assets/brand/junqi-logo-full.png';

type JunQiLogoVariant = 'full' | 'emblem' | 'lockup';

interface JunQiLogoProps {
  variant?: JunQiLogoVariant;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const BRAND_TITLE = '陕西浚启智境科技有限公司 JunQi';

export function JunQiLogo({ variant = 'full', className, style, title = BRAND_TITLE }: JunQiLogoProps) {
  if (variant === 'lockup') {
    return (
      <div
        role="img"
        aria-label={title}
        className={clsx('flex min-w-0 items-center gap-2', className)}
        style={style}
      >
        <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-md">
          <img
            src={emblemUrl}
            alt=""
            aria-hidden="true"
            className="block h-7 w-10 object-contain"
            draggable={false}
          />
        </span>
        <span className="min-w-0 leading-none">
          <span className="block truncate text-[14px] font-extrabold text-aegis-text">JunQi</span>
          <span className="mt-1 block truncate text-[10px] font-semibold text-aegis-text-dim">Desktop</span>
        </span>
      </div>
    );
  }

  return (
    <img
      src={variant === 'emblem' ? emblemUrl : fullLogoUrl}
      alt={title}
      className={clsx('block object-contain', className)}
      style={style}
      draggable={false}
    />
  );
}
