// ═══════════════════════════════════════════════════════════
// ReminderBadge — Cron job status indicator for events
// ═══════════════════════════════════════════════════════════

import { useTranslation } from 'react-i18next';
import { Circle, CheckCircle2, XCircle } from 'lucide-react';
import type { ReminderStatus } from './calendarTypes';
import React from 'react';

interface ReminderBadgeProps {
  status: ReminderStatus;
  size?: 'sm' | 'md';
}

const s = (size: string) => size === 'sm' ? 10 : 12;

const STATUS_CONFIG: Record<ReminderStatus, React.ReactNode> = {
  scheduled: <Circle size={12} fill="rgb(74 222 128)" stroke="none" />,
  pending:   <Circle size={12} fill="rgb(251 191 36)" stroke="none" />,
  fired:     <CheckCircle2 size={12} className="text-green-400" />,
  failed:    <XCircle size={12} className="text-red-400" />,
  none:      null,
};

export function ReminderBadge({ status }: ReminderBadgeProps) {
  if (status === 'none') return null;
  const icon = STATUS_CONFIG[status];
  return <span className="shrink-0 flex items-center">{icon}</span>;
}
