import * as Popover from '@radix-ui/react-popover';
import type { ReactNode, RefObject } from 'react';

interface ComposerSuggestionPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dir: 'ltr' | 'rtl';
  startOffset: number;
  width: number;
  textareaRef: RefObject<HTMLTextAreaElement>;
  children: ReactNode;
}

/**
 * Suggestion panels are anchored to the composer but rendered in a portal so
 * their dimensions cannot create horizontal scroll range in the chat surface.
 */
export function ComposerSuggestionPopover({
  open,
  onOpenChange,
  dir,
  startOffset,
  width,
  textareaRef,
  children,
}: ComposerSuggestionPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>
        <span
          aria-hidden
          className="absolute top-2 size-px"
          style={{ insetInlineStart: startOffset }}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          dir={dir}
          side="top"
          align={dir === 'rtl' ? 'end' : 'start'}
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            textareaRef.current?.focus();
          }}
          className="z-50 max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg text-aegis-text shadow-[var(--aegis-menu-shadow)]"
          style={{ width }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
