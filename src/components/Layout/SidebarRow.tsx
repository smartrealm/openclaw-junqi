// SidebarRow + SidebarSection — 通用 ListRow + Section 容器
// icon 和 live 互斥：live=true 时左侧显示状态点，icon 显示则不显示 live dot

import type { ReactNode, KeyboardEvent } from 'react';
import clsx from 'clsx';

interface SidebarRowProps {
  icon?: ReactNode;
  title: string;
  meta?: string;
  live?: boolean;
  active?: boolean;
  onClick: () => void;
}

export function SidebarRow({ icon, title, meta, live, active, onClick }: SidebarRowProps) {
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKey}
      className={clsx(
        'flex items-start gap-2.5 px-4 py-2.5 cursor-pointer transition-colors',
        // Selection state: opaque accent-tinted background + left accent stripe.
        // Was bg-aegis-primary/15 — too subtle, read as "same as unselected".
        // Now uses a denser overlay + a 2px-wide accent stripe so the active
        // row is unmistakably distinct from the unselected rows around it.
        active
          ? 'bg-[rgb(var(--aegis-primary)/0.22)] border-l-2 border-l-aegis-primary shadow-[inset_1px_0_0_rgb(var(--aegis-primary)/0.55)]'
          : 'border-l-2 border-l-transparent hover:bg-aegis-overlay/[0.04]',
      )}
    >
      {live ? (
        <span className="w-[5px] h-[5px] rounded-full mt-[5px] shrink-0 bg-aegis-success shadow-[0_0_0_3px_rgb(61_214_140/0.22)]" />
      ) : icon ? (
        <span className="shrink-0 opacity-80 mt-[2px]">{icon}</span>
      ) : (
        <span className="w-[5px] h-[5px] mt-[5px] shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className={clsx('text-[13px] truncate leading-5', active ? 'text-aegis-text font-semibold' : 'text-aegis-text')}>{title}</div>
        {meta && <div className="text-[11px] text-aegis-text-dim mt-0.5 truncate leading-4">{meta}</div>}
      </div>
    </div>
  );
}

interface SidebarSectionProps {
  label: string;
  children: ReactNode;
}

export function SidebarSection({ label, children }: SidebarSectionProps) {
  return (
    <div className="py-1">
      <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-aegis-text-dim">{label}</div>
      {children}
    </div>
  );
}
