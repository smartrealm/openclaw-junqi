import { Building2, Cloud, MessagesSquare, type LucideProps } from 'lucide-react';
import type { IntegrationIconName } from '@/business-applications/types';

const ICONS: Record<IntegrationIconName, typeof Building2> = {
  building: Building2,
  messages: MessagesSquare,
  cloud: Cloud,
};

export function BusinessApplicationIcon({ icon, ...props }: LucideProps & {
  icon: IntegrationIconName;
}) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
}
