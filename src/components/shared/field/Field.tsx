// Field — Aegis Design System
// label + hint + error wrapper used by ConfigManager / SettingsDialog.

import { type ReactNode, useId } from "react";
import clsx from "clsx";
import s from "./field.module.css";

export interface FieldProps {
  label?:     ReactNode;
  hint?:      ReactNode;
  error?:     ReactNode;
  required?:  boolean;
  disabled?:  boolean;
  children:   ReactNode;
  className?: string;
  /** Pass an explicit id to link label to control. Auto-generated otherwise. */
  htmlFor?:   string;
}

export function Field({
  label,
  hint,
  error,
  required,
  disabled,
  children,
  className,
  htmlFor,
}: FieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;

  return (
    <div
      className={clsx(s.field, className)}
      data-error={!!error || undefined}
      data-disabled={disabled || undefined}
    >
      {label ? (
        <label className={s.label} htmlFor={id}>
          {label}
          {required && <span className={s.required} aria-hidden="true">*</span>}
        </label>
      ) : null}

      <div className={s.control}>{children}</div>

      {hint && !error ? (
        <p className={s.hint}>{hint}</p>
      ) : null}

      {error ? (
        <p className={s.error} role="alert">{error}</p>
      ) : null}
    </div>
  );
}
