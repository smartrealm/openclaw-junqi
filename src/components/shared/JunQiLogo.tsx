import { useId, type CSSProperties } from 'react';
import clsx from 'clsx';

type JunQiLogoVariant = 'full' | 'emblem';

interface JunQiLogoProps {
  variant?: JunQiLogoVariant;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

function GradientStops({ id }: { id: string }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="146.3" y2="81.2">
      <stop offset="0" stopColor="rgb(var(--aegis-success))" />
      <stop offset="0.52" stopColor="rgb(var(--aegis-accent))" />
      <stop offset="1" stopColor="rgb(var(--aegis-primary-deep))" />
    </linearGradient>
  );
}

function EmblemPaths({ fill }: { fill: string }) {
  return (
    <>
      <path fill={fill} d="M102.1,40C77.9,48.8,55.2,5.1,32.9,6.6C17.6,7.8,9.7,21.8,9.7,21.8s17.6-15.4,36-3.3C62.1,29.1,77.5,55.7,102.1,40z" />
      <path fill={fill} d="M36.8,0.6c0,0,15.1-5.7,39.5,18.7s49.1-17.7,64,0.4c0,0,6.1,0.6,6,6.2c0,0-9.7-6.4-28.6,5.8s-35,4.3-45.1-6.9S52.5,1.9,36.8,0.6z" />
      <path fill={fill} d="M130,14.1c0,0-14.2,2-29-8.1C101,6,101.9,19.4,130,14.1z" />
      <path fill={fill} d="M129.7,13.6c0,0-8.3-1-15.1-8.9C114.6,4.6,113,12.3,129.7,13.6z" />
      <path fill={fill} d="M33.3,25.1C45.5,26.6,54,48.8,72,43.5c-20.4-3.6-24.2-33.1-50.6-23.2c-22.3,8.4-25,31.3-17.7,44.9C10,77.1,23.6,84.5,36,79.7C18.6,83.7,5.3,64,7.3,46.8C8.8,33.1,21.2,23.7,33.3,25.1z" />
    </>
  );
}

export function JunQiLogo({ variant = 'full', className, style, title = 'JunQi Desktop' }: JunQiLogoProps) {
  const rawId = useId().replace(/:/g, '');
  const gradientId = `junqi-logo-gradient-${rawId}`;
  const fill = `url(#${gradientId})`;

  if (variant === 'emblem') {
    return (
      <svg
        viewBox="0 0 146.3 81.2"
        role="img"
        aria-label={title}
        className={clsx('block', className)}
        style={style}
      >
        <defs>
          <GradientStops id={gradientId} />
        </defs>
        <EmblemPaths fill={fill} />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 1300 360"
      role="img"
      aria-label={title}
      className={clsx('block', className)}
      style={style}
    >
      <defs>
        <GradientStops id={gradientId} />
      </defs>
      <g transform="translate(113,48) scale(2.2)">
        <EmblemPaths fill={fill} />
      </g>
      <text
        x="392"
        y="132"
        fontFamily="Inter, PingFang SC, Microsoft YaHei, sans-serif"
        fontSize="24"
        fontWeight="760"
        letterSpacing="0.04em"
        fill="rgb(var(--aegis-text-secondary))"
      >
        Shaanxi JunQi Intelligence Technology Co., Ltd.
      </text>
      <text
        x="150"
        y="200"
        fontFamily="PingFang SC, Microsoft YaHei, Heiti SC, sans-serif"
        fontSize="70"
        fontWeight="900"
        fill="rgb(var(--aegis-text))"
      >
        陕西浚启智境科技有限公司
      </text>
      <text
        x="180"
        y="244"
        fontFamily="Inter, PingFang SC, Microsoft YaHei, sans-serif"
        fontSize="26"
        fontWeight="820"
        letterSpacing="0.02em"
        fill="rgb(var(--aegis-text-secondary))"
      >
        JunQi  |  深浚其智，广启其途
      </text>
    </svg>
  );
}
