import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/shared/button';

export interface SidebarPrimaryActionProps extends Omit<
  ButtonProps,
  'children' | 'className' | 'fullWidth' | 'leadingIcon' | 'size' | 'tone' | 'variant'
> {
  children: ReactNode;
  icon: ReactNode;
}

export function SidebarPrimaryAction({
  children,
  icon,
  ...buttonProps
}: SidebarPrimaryActionProps) {
  return (
    <div className="mb-3 mt-1 pe-4 ps-[var(--aegis-sidebar-menu-row-inset)]">
      <Button
        {...buttonProps}
        variant="soft"
        tone="primary"
        size="lg"
        fullWidth
        leadingIcon={icon}
        className="!justify-start !pe-4 !ps-[var(--aegis-sidebar-action-icon-padding)]"
      >
        {children}
      </Button>
    </div>
  );
}
