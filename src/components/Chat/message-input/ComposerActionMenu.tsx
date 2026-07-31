import type { ReactElement, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ComposerActionMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dir: 'ltr' | 'rtl';
  align: 'start' | 'end';
  ariaLabel: string;
  trigger: ReactElement;
  children: ReactNode;
}

/**
 * Composer actions must render outside the scrolling chat surface. This keeps
 * popup dimensions out of the conversation layout while preserving keyboard
 * navigation and viewport collision handling from the shared menu primitive.
 */
export function ComposerActionMenu({
  open,
  onOpenChange,
  dir,
  align,
  ariaLabel,
  trigger,
  children,
}: ComposerActionMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} dir={dir}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align={align}
        sideOffset={8}
        collisionPadding={12}
        aria-label={ariaLabel}
        className="w-40 border-aegis-menu-border bg-aegis-menu-bg p-1 text-aegis-text shadow-[var(--aegis-menu-shadow)]"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ComposerActionMenuItemProps {
  icon: LucideIcon;
  children: ReactNode;
  onSelect: () => void;
}

export function ComposerActionMenuItem({
  icon: Icon,
  children,
  onSelect,
}: ComposerActionMenuItemProps) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="gap-2 rounded-md px-2.5 py-2 text-[11px] font-medium text-aegis-text-secondary focus:bg-[rgb(var(--aegis-overlay)/0.06)] focus:text-aegis-text"
    >
      <Icon size={14} className="shrink-0 text-aegis-primary" />
      {children}
    </DropdownMenuItem>
  );
}
