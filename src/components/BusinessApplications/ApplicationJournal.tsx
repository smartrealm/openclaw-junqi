import { Bot, ClipboardList, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function ApplicationJournal() {
  const { t } = useTranslation();
  return (
    <aside className="flex min-h-[252px] min-w-0 flex-col border border-aegis-border bg-aegis-surface/35">
      <header className="flex items-center gap-2 border-b border-aegis-border px-4 py-3">
        <ClipboardList size={15} className="text-aegis-text-dim" aria-hidden="true" />
        <h2 className="text-[11.5px] font-semibold text-aegis-text-secondary">{t('businessApplications.journalTitle', '操作记录')}</h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col justify-center px-4 py-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-aegis-overlay/[0.05] text-aegis-text-dim"><ShieldCheck size={16} aria-hidden="true" /></div>
        <h3 className="mt-3 text-[12px] font-medium text-aegis-text-secondary">{t('businessApplications.journalEmptyTitle', '尚无业务操作')}</h3>
        <p className="mt-1.5 text-[10.5px] leading-5 text-aegis-text-dim">{t('businessApplications.journalEmptyDescription', '手动操作与 AI 提议确认后都会在此形成同一条可追溯记录。')}</p>
        <div className="mt-5 border-t border-aegis-border/70 pt-3">
          <div className="flex items-start gap-2 text-[10.5px] leading-5 text-aegis-text-dim">
            <Bot size={13} className="mt-0.5 shrink-0 text-aegis-primary" aria-hidden="true" />
            {t('businessApplications.journalBoundary', 'AI 不读取密钥或原始业务正文，只接收完成计划所需的脱敏结构化上下文。')}
          </div>
        </div>
      </div>
    </aside>
  );
}
