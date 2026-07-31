import { MessageSquare } from 'lucide-react';
import type { SessionChannelIconKind } from '@/utils/sessionChannelPresentation';

interface SessionChannelIconProps {
  icon: SessionChannelIconKind;
  size?: number;
}

export function SessionChannelIcon({ icon, size = 13 }: SessionChannelIconProps) {
  switch (icon) {
    case 'generic':
      return <MessageSquare size={size} aria-hidden="true" />;
  }
}
