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
        'flex items-start gap-2.5 px-4 py-2 border-l-2 cursor-pointer transition-colors',
        active
          ? 'border-l-aegis-primary bg-aegis-primary/15'
          : 'border-l-transparent hover:bg-aegis-overlay/[0.04]',
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
        <div className="text-[12px] text-aegis-text truncate">{title}</div>
        {meta && <div className="text-[10px] text-aegis-text-dim mt-0.5 truncate">{meta}</div>}
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
      <div className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-aegis-text-dim">{label}</div>
      {children}
    </div>
  );
}
