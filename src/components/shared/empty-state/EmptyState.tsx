// EmptyState — Aegis Design System
// Adapted from Hermes shared-ui empty-state.
// Dashed border + centered icon + title + description + actions.
// variant="subtle" (default): dashed card; "plain": no border/bg; "compact": smaller padding.
import { type ReactNode } from "react";
import clsx from "clsx";
import s from "./empty-state.module.css";

export type EmptyStateVariant = "subtle" | "plain" | "compact";

export interface EmptyStateProps {
  icon?:        ReactNode;
  title:        ReactNode;
  description?: ReactNode;
  actions?:     ReactNode;
  variant?:     EmptyStateVariant;
  className?:   string;
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
  variant   = "subtle",
  className,
}: EmptyStateProps) {
  return (
    <div className={clsx(s.emptyState, className)} data-variant={variant}>
      {icon ? <div className={s.icon}>{icon}</div> : null}
      <div className={s.body}>
        <div className={s.title}>{title}</div>
        {description ? <div className={s.description}>{description}</div> : null}
      </div>
      {actions ? <div className={s.actions}>{actions}</div> : null}
    </div>
  );
}
