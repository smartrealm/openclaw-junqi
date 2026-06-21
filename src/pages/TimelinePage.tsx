// ═══════════════════════════════════════════════════════════
// Timeline Page — Visual session history, ported from nezha's
// TimelineView and adapted to OpenClaw chat session data model.
// Each entry shows: time, session label, token count, status.
// Styling uses CSS-variable bridges for theme compatibility.
// ═══════════════════════════════════════════════════════════

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Clock, MessageSquare, Loader2 } from "lucide-react";
import { useGatewayDataStore, refreshGroup } from "@/stores/gatewayDataStore";
import { formatTokens } from "@/utils/format";
import { getSessionDisplayLabel } from "@/utils/sessionLabel";
import type { SessionInfo } from "@/stores/gatewayDataStore";

// ── CSS-variable bridge ──
// Mirrors src/styles/nezha/timeline.ts style keys exactly;
// all colour / spacing tokens resolve at runtime via the active
// theme's CSS custom properties (--text-primary, --bg-panel, etc.).
const s = {
  timelinePane: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflowY: "auto" as const,
    background: "var(--bg-panel)",
    padding: "28px 28px 32px",
  },
  timelineHeader: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 4,
  },
  timelineSubtitle: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 24,
  },
  timelineGroup: {
    display: "flex",
    flexDirection: "column" as const,
    marginBottom: 24,
  },
  timelineGroupHeader: {
    display: "flex",
    alignItems: "baseline" as const,
    gap: 10,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: "1px solid var(--border-dim)",
  },
  timelineGroupTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-secondary)",
    letterSpacing: 0.4,
    textTransform: "uppercase" as const,
  },
  timelineGroupCount: {
    fontSize: 11.5,
    color: "var(--text-hint)",
    fontWeight: 500,
  },
  timelineList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  timelineRow: {
    display: "flex",
    alignItems: "center" as const,
    gap: 10,
    padding: "8px 10px",
    borderRadius: 6,
    cursor: "default",
    border: "none",
    background: "transparent",
    textAlign: "left" as const,
    width: "100%",
  },
  timelineRowTime: {
    fontSize: 11.5,
    color: "var(--text-hint)",
    fontVariantNumeric: "tabular-nums" as const,
    width: 48,
    flexShrink: 0,
  },
  timelineRowStatus: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center" as const,
  },
  timelineRowMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  timelineRowTitle: {
    fontSize: 13,
    color: "var(--text-primary)",
    fontWeight: 500,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  timelineRowMeta: {
    display: "flex",
    alignItems: "center" as const,
    gap: 8,
    fontSize: 11.5,
    color: "var(--text-muted)",
  },
  timelineRowMetaSep: {
    color: "var(--text-hint)",
  },
  timelineRowTokens: {
    fontVariantNumeric: "tabular-nums" as const,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11,
    color: "var(--text-secondary)",
  },
  timelineEmpty: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: "60px 24px",
    color: "var(--text-muted)",
    fontSize: 13,
    textAlign: "center" as const,
    gap: 12,
  },
};

// ── Types ──

type Bucket = "today" | "yesterday" | "earlier";

interface TimelineEntry {
  session: SessionInfo;
  bucket: Bucket;
}

interface TimelineGroup {
  bucket: Bucket;
  entries: TimelineEntry[];
}

// ── Helpers ──

function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketFor(ts: number, now: Date): Bucket {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  if (ts >= todayStart) return "today";
  if (ts >= yesterdayStart) return "yesterday";
  return "earlier";
}

function sessionTimestamp(session: SessionInfo): number {
  const raw = session.lastActive;
  if (!raw) return 0;
  const d = new Date(raw);
  const n = d.getTime();
  return isNaN(n) ? 0 : n;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const AVATAR_COLORS = [
  "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
  "#f97316", "#14b8a6",
];

function avatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? "#0ea5e9";
}

// ── Sub-components ──

function SessionStatusIcon({ session }: { session: SessionInfo }) {
  if (session.running) {
    return (
      <Loader2
        size={13}
        strokeWidth={2}
        style={{ color: "var(--accent-primary, #0ea5e9)" }}
      />
    );
  }
  return (
    <MessageSquare size={13} strokeWidth={1.6} style={{ color: "var(--text-hint)" }} />
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const session = entry.session;
  const ts = sessionTimestamp(session);

  const label = getSessionDisplayLabel({
    key: session.key,
    label: session.label,
    topic: (session as any).topic as string | undefined,
    kind: session.kind,
  } as any);

  const modelColor = avatarColor(session.key);
  const hasTokens = session.totalTokens != null && session.totalTokens > 0;

  return (
    <div style={s.timelineRow}>
      <span style={s.timelineRowTime}>
        {ts > 0 ? formatTime(ts) : "--:--"}
      </span>
      <span style={s.timelineRowStatus}>
        <SessionStatusIcon session={session} />
      </span>
      <div style={s.timelineRowMain}>
        <div style={s.timelineRowTitle}>{label}</div>
        <div style={s.timelineRowMeta}>
          {session.model ? (
            <>
              <span style={{ color: modelColor, fontWeight: 500 }}>
                {session.model}
              </span>
              {hasTokens ? (
                <span style={s.timelineRowMetaSep}>·</span>
              ) : null}
            </>
          ) : null}
          {hasTokens ? (
            <span style={s.timelineRowTokens}>
              {formatTokens(session.totalTokens!)} tokens
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Page ──

export function TimelinePage() {
  const { t } = useTranslation();
  const sessions = useGatewayDataStore((s) => s.sessions);

  // Refresh sessions from gateway on mount
  useEffect(() => {
    refreshGroup("sessions");
  }, []);

  const groups = useMemo<TimelineGroup[]>(() => {
    const now = new Date();

    // Only include sessions active within the last 30 days
    const cutoff = startOfDay(now) - 30 * 24 * 60 * 60 * 1000;
    const entries: TimelineEntry[] = [];

    for (const ses of sessions) {
      const ts = sessionTimestamp(ses);
      if (ts <= 0 || ts < cutoff) continue;
      entries.push({ session: ses, bucket: bucketFor(ts, now) });
    }

    // Sort newest first within each bucket
    entries.sort(
      (a, b) => sessionTimestamp(b.session) - sessionTimestamp(a.session),
    );

    const byBucket: Record<Bucket, TimelineEntry[]> = {
      today: [],
      yesterday: [],
      earlier: [],
    };
    for (const e of entries) {
      byBucket[e.bucket].push(e);
    }

    return (
      [
        { bucket: "today" as Bucket, entries: byBucket.today },
        { bucket: "yesterday" as Bucket, entries: byBucket.yesterday },
        { bucket: "earlier" as Bucket, entries: byBucket.earlier },
      ] as TimelineGroup[]
    ).filter((g) => g.entries.length > 0);
  }, [sessions]);

  const titleFor = (bucket: Bucket): string => {
    switch (bucket) {
      case "today":
        return t("timeline.today", "Today");
      case "yesterday":
        return t("timeline.yesterday", "Yesterday");
      default:
        return t("timeline.earlier", "Earlier");
    }
  };

  return (
    <div style={s.timelinePane}>
      <div style={s.timelineHeader}>
        {t("timeline.title", "Timeline")}
      </div>
      <div style={s.timelineSubtitle}>
        {t("timeline.subtitle", "Recent session activity")}
      </div>

      {groups.length === 0 ? (
        <div style={s.timelineEmpty}>
          <Clock size={28} strokeWidth={1.2} style={{ color: "var(--text-hint)" }} />
          <div>{t("timeline.empty", "No recent sessions")}</div>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.bucket} style={s.timelineGroup}>
            <header style={s.timelineGroupHeader}>
              <span style={s.timelineGroupTitle}>{titleFor(group.bucket)}</span>
              <span style={s.timelineGroupCount}>
                {group.entries.length}{" "}
                {group.entries.length === 1
                  ? t("timeline.sessionSingular", "session")
                  : t("timeline.sessionPlural", "sessions")}
              </span>
            </header>
            <div style={s.timelineList}>
              {group.entries.map((entry) => (
                <TimelineRow key={entry.session.key} entry={entry} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

export default TimelinePage;
