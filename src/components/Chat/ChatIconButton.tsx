import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ChatIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export const ChatIconButton = forwardRef<HTMLButtonElement, ChatIconButtonProps>(function ChatIconButton(
  { label, children, ...buttonProps },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button ref={ref} {...buttonProps} aria-label={label}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
});
