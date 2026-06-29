// Alert — Aegis Design System
// Adapted from Hermes shared-ui alert.tsx.
// Inline (title + body + actions in a row) or stack layout.
// Automatically resolves a11y role: danger -> alert, others -> status.
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import s from "./alert.module.css";

export type AlertTone   = "neutral" | "info" | "primary" | "success" | "warning" | "danger";
export type AlertSize   = "sm" | "md";
export type AlertLayout = "stack" | "inline";

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?:    AlertTone;
  size?:    AlertSize;
  layout?:  AlertLayout;
  title?:   ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  {
    className,
    tone    = "neutral",
    size    = "md",
    layout  = "stack",
    title,
    actions,
    children,
    role,
    ...props
  },
  ref,
) {
  const resolvedRole = role ?? (tone === "danger" ? "alert" : "status");
  return (
    <div
      {...props}
      ref={ref}
      role={resolvedRole}
      className={clsx(s.alert, className)}
      data-tone={tone}
      data-size={size}
      data-layout={layout}
    >
      <div className={s.body}>
        {title ? <strong className={s.title}>{title}</strong> : null}
        <div className={s.content}>{children}</div>
      </div>
      {actions ? <div className={s.actions}>{actions}</div> : null}
    </div>
  );
});
