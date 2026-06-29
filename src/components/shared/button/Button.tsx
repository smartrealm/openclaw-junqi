// Button + IconButton — Aegis Design System
// Adapted from Hermes shared-ui button.tsx, using aegis-* tokens.
// data-* attributes drive all CSS variants — no clsx switching needed.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import s from './button.module.css';

export type ButtonVariant = 'solid' | 'soft' | 'outline' | 'ghost' | 'plain';
export type ButtonTone    = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export type ButtonSize    = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:      ButtonVariant;
  tone?:         ButtonTone;
  size?:         ButtonSize;
  fullWidth?:    boolean;
  loading?:      boolean;
  iconOnly?:     boolean;
  leadingIcon?:  ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    type = 'button',
    variant = 'ghost',
    tone = 'neutral',
    size = 'md',
    fullWidth = false,
    loading = false,
    iconOnly = false,
    leadingIcon,
    trailingIcon,
    disabled,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-tone={tone}
      data-size={size}
      data-full-width={fullWidth ? "true" : undefined}
      data-icon-only={iconOnly ? "true" : undefined}
      data-loading={loading ? "true" : undefined}
      className={clsx(s.button, className)}
    >
      {loading ? <span className={s.spinner} aria-hidden="true" /> : leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});

// IconButton — square icon-only shortcut, defaults to ghost/sm
export interface IconButtonProps extends Omit<ButtonProps, 'iconOnly'> {
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'sm', variant = 'ghost', children, ...props },
  ref,
) {
  return (
    <Button {...props} ref={ref} size={size} variant={variant} iconOnly>
      {children}
    </Button>
  );
});
