import type { ReactNode } from 'react';

interface TerminalKookyMenuItemProps {
  label: string;
  onClick: () => void;
  shortcut?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
}

/** Shared Kooky popover row for terminal chrome menus. */
export function TerminalKookyMenuItem({
  label,
  onClick,
  shortcut,
  leading,
  trailing,
  disabled = false,
}: TerminalKookyMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className="terminal-kooky-menu-item"
      disabled={disabled}
      onClick={onClick}
    >
      {leading && <span className="terminal-kooky-menu-leading">{leading}</span>}
      <span className="terminal-kooky-menu-label">{label}</span>
      {shortcut && <span className="terminal-kooky-menu-shortcut">{shortcut}</span>}
      {trailing && <span className="terminal-kooky-menu-trailing">{trailing}</span>}
    </button>
  );
}

export function TerminalKookyMenuDivider() {
  return <div className="terminal-kooky-menu-divider" role="separator" />;
}
