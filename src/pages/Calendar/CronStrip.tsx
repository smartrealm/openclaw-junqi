/**
 * CronStrip — upcoming cron jobs and reminders condensed into a
 * horizontal strip above the calendar grid.
 *
 * - Left: today's + next 7 days cron schedule (compact chips)
 * - Right: pending reminder count badge
 *
 * Data sources: gatewayDataStore (cronJobs) + calendarStore (events with reminders)
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Bell } from "lucide-react";
import { useGatewayDataStore } from "@/stores/gatewayDataStore";
import { useCalendarStore } from "@/stores/calendarStore";
import { toDateStr } from "./calendarUtils";

export function CronStrip() {
  const { t } = useTranslation();
  const cronJobs = useGatewayDataStore((s) => s.cronJobs);
  const { events } = useCalendarStore();

  // ── Upcoming cron runs (next 7 days) ──
  const upcomingCrons = useMemo(() => {
    const today = toDateStr(new Date());
    const end = toDateStr(new Date(Date.now() + 7 * 86400000));
    return cronJobs
      .filter((j) => j.enabled !== false && j.lastRun)
      .map((j) => {
        const last = new Date(j.lastRun!);
        const label = j.name || j.id;
        return { id: j.id, label, lastRun: last, status: j.lastRunStatus };
      })
      .slice(0, 6);
  }, [cronJobs]);

  // ── Upcoming reminders ──
  const upcomingReminders = useMemo(() => {
    const today = toDateStr(new Date());
    return events
      .filter(
        (e) =>
          e.reminderMinutes > 0 &&
          e.date >= today &&
          e.status !== "cancelled" &&
          e.status !== "completed"
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 6);
  }, [events]);

  if (upcomingCrons.length === 0 && upcomingReminders.length === 0) return null;

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-aegis-border bg-[rgb(var(--aegis-overlay)/0.02)] shrink-0 overflow-x-auto scrollbar-hidden">
      {/* ── Cron jobs ── */}
      {upcomingCrons.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          <Clock size={12} className="text-aegis-text-dim shrink-0" />
          <span className="text-[10px] font-semibold text-aegis-text-dim uppercase tracking-wider shrink-0">
            {t("calendar.cron", "Cron")}
          </span>
          <div className="flex items-center gap-1.5">
            {upcomingCrons.map((cr) => (
              <span
                key={cr.id}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border border-aegis-border bg-aegis-card whitespace-nowrap"
                title={`${cr.label}\nLast: ${cr.lastRun.toLocaleString()}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    cr.status === "ok"
                      ? "bg-aegis-success"
                      : cr.status === "error"
                        ? "bg-aegis-danger"
                        : "bg-aegis-text-dim"
                  }`}
                />
                {cr.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* separator */}
      {upcomingCrons.length > 0 && upcomingReminders.length > 0 && (
        <span className="w-px h-4 bg-aegis-border shrink-0" />
      )}

      {/* ── Reminders ── */}
      {upcomingReminders.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          <Bell size={12} className="text-aegis-warning shrink-0" />
          <span className="text-[10px] font-semibold text-aegis-text-dim uppercase tracking-wider shrink-0">
            {t("calendar.reminders", "Reminders")}
          </span>
          <div className="flex items-center gap-1.5">
            {upcomingReminders.map((ev) => (
              <span
                key={ev.id}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-aegis-warning/20 bg-aegis-warning/[0.06] text-aegis-warning whitespace-nowrap"
                title={`${ev.title} — ${ev.date} ${ev.startTime || ""}\nReminder: ${ev.reminderMinutes}min before`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    ev.reminderStatus === "scheduled"
                      ? "bg-aegis-success"
                      : ev.reminderStatus === "pending"
                        ? "bg-aegis-warning"
                        : ev.reminderStatus === "failed"
                          ? "bg-aegis-danger"
                          : "bg-aegis-text-dim"
                  }`}
                />
                {ev.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
