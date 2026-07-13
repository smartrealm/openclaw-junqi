import type { CSSProperties } from 'react';
import clsx from 'clsx';
import emblemUrl from '@/assets/brand/junqi-emblem.svg';

type JunQiLogoVariant = 'full' | 'emblem' | 'lockup' | 'company-emblem';

interface JunQiLogoProps {
  variant?: JunQiLogoVariant;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const BRAND_TITLE = '陕西浚启智境科技有限公司';

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
      <span
        role="img"
        aria-label={title}
        className={clsx('flex min-w-0 items-center gap-2', className)}
        style={style}
      >
        <img src={emblemUrl} alt="" className="block h-7 w-10 shrink-0 object-contain" draggable={false} />
        <span className="min-w-0 leading-none">
          <span className="block truncate text-[12px] font-semibold text-aegis-text">浚启智境</span>
          <span className="mt-1 block truncate text-[7.5px] font-medium text-aegis-text-muted">
            JUNQI INTELLIGENCE
          </span>
        </span>
      </span>
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
          src={emblemUrl}
          alt=""
          aria-hidden="true"
          className="block h-full w-full object-contain"
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
        'flex min-w-0 items-center justify-center gap-3',
        className,
      )}
      style={style}
    >
      <img
        src={emblemUrl}
        alt=""
        aria-hidden="true"
        className="block h-[76%] w-auto max-w-[28%] shrink-0 object-contain"
        draggable={false}
      />
      <span className="min-w-0 text-left leading-none">
        <span className="block truncate text-[15px] font-bold text-aegis-text">
          陕西浚启智境科技有限公司
        </span>
        <span className="mt-2 block truncate text-[9px] font-semibold text-aegis-text-muted">
          JunQi&nbsp;&nbsp;·&nbsp;&nbsp;深浚其智，广启其途
        </span>
      </span>
    </span>
  );
}
