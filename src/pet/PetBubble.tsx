import { useEffect, useState, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, FileArchive, FileCode2, FileText, FolderOpen, type LucideIcon } from 'lucide-react';
import { themeHex } from '@/utils/theme-colors';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PetEmotion, PetState } from './pet-states';
import type { DragKind } from '@/stores/petStore';
import { pomodoroIcon, pomodoroColor, celebrateIcon, CELEBRATE_CAPTION } from './pomodoroView';

/** Fallback status labels (used until/unless i18n keys are present). */
const STATUS_LABEL: Record<PetEmotion, string> = {
  idle: '空闲中',
  thinking: '思考中',
  typing: '回复中',
  tool: '调工具',
  working: '工作中',
  happy: '完成啦',
  celebrate: '任务完成',
  error: '出错了',
  sleepy: '犯困',
  sleep: '休息中',
  memory: '整理记忆',
  drag: '准备好接收…',
  overdrag: '放下就开吃!',
  swallow: '嚼嚼嚼…',
  rapidSwallow: '还没吃完呢!',
};

/** Per-emotion accent color — recomputed on every render so the themeHex()
 *  calls always read the current `--aegis-*` CSS variables. themeHex
 *  internally uses getComputedStyle so calling it during render is correct
 *  and inexpensive (a few getPropertyValue reads per emotion). */
function useEmotionColor(): Record<PetEmotion, string> {
  return {
    idle: 'rgb(var(--aegis-text-dim))',
    thinking: themeHex('accent'),
    typing: themeHex('primary'),
    tool: themeHex('accent'),
    working: themeHex('warning'),
    happy: themeHex('success'),
    celebrate: themeHex('success'),
    error: themeHex('danger'),
    sleepy: 'rgb(var(--aegis-text-dim))',
    sleep: 'rgb(var(--aegis-text-muted))',
    memory: themeHex('warning'),
    drag: themeHex('accent'),
    overdrag: themeHex('primary'),
    swallow: themeHex('primary'),
    rapidSwallow: themeHex('warning'),
  };
}

/** Map a drag payload kind to the icon + colour used in the drag bubble.
 *  Falls back to a generic file icon when classification is ambiguous. */
function useDragKindMeta() {
  return {
    icon: (k: DragKind): LucideIcon => {
      switch (k) {
        case 'image': return Image;
        case 'archive': return FileArchive;
        case 'code': return FileCode2;
        case 'text': return FileText;
        case 'folder': return FolderOpen;
        default: return FileText;
      }
    },
    color: (k: DragKind): string => {
      switch (k) {
        case 'image': return themeHex('accent');
        case 'archive': return themeHex('warning');
        case 'code': return themeHex('primary');
        case 'text': return 'rgb(var(--aegis-text-dim))';
        case 'folder': return themeHex('success');
        default: return 'rgb(var(--aegis-text-dim))';
      }
    },
  };
}

/** Active states get the rich multi-line bubble (label + action + elapsed). */
const ACTIVE: ReadonlySet<PetEmotion> = new Set(['thinking', 'typing', 'tool', 'working', 'memory']);

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

/** MM:SS for a millisecond countdown. */
function fmtClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const m = Math.floor(clamped / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatStatusDetail(value: string): string {
  return value
    .replace(/([。！？!?；;])\s*/g, '$1\n')
    .replace(/([，,])\s*/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isSameStatusCopy(a?: string, b?: string): boolean {
  const normalize = (value?: string) => (value || '')
    .replace(/[!！。.\s]/g, '')
    .trim()
    .toLocaleLowerCase();
  const left = normalize(a);
  const right = normalize(b);
  return Boolean(left && right && left === right);
}

/** Resolve the user-selected theme to a concrete "is the UI dark?" boolean
 * (handles the 'system' value by following the OS preference). */
function useResolvedDark(): boolean {
  const theme = useSettingsStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  if (theme === 'aegis-dark') return true;
  if (theme === 'aegis-midnight') return true;
  if (theme === 'aegis-light') return false;
  if (theme === 'aegis-eyecare') return false;
  return systemDark;
}

function petTextPalette(isDark: boolean): { primary: string; secondary: string; danger: string } {
  return isDark
    ? {
        primary: '#ffffff',
        secondary: '#e2e8f0',
        danger: '#fecaca',
      }
    : {
        primary: '#111827',
        secondary: '#1f2937',
        danger: '#991b1b',
      };
}

/**
 * Compact status bubble above the character. It stays as pure text so the pet
 * does not look boxed in.
 *
 * Display priority (high → low):
 * dragging > error > active(chat) > celebrate/happy > pomodoro countdown >
 * sleep/sleepy > hover carousel > idle (no bubble).
 *
 * `bubbleKey` follows the bubble's logical type, so AnimatePresence cross-fades
 * when the type changes but leaves within-type updates untouched.
 */
export function PetBubble({ state, dragging, hovered }: { state: PetState; dragging?: boolean; hovered?: boolean }) {
  const { t } = useTranslation();
  const isDark = useResolvedDark();
  const emotionColor = useEmotionColor();
  const dragMeta = useDragKindMeta();
  const e = state.emotion;
  const label = t(`pet.status.${e}`, STATUS_LABEL[e]);
  const textPalette = petTextPalette(isDark);

  // Operation-hint carousel, shown only while the cursor is over the pet
  // AND the pet is idle (i.e. the tip branch is the rendered body — busy
  // / celebrate / pomodoro branches suppress the bubble). Cycle interval
  // 2.5s with a soft cross-fade. Leaving the pet immediately stops and
  // resets to the first tip.
  const tips = [
    t('pet.hint.tip1', '双击 → 打开主窗口'),
    t('pet.hint.tip2', '按住拖动 → 移动位置'),
    t('pet.hint.tip3', '托盘图标 → 显示/隐藏'),
    t('pet.hint.tip4', '右键 → 菜单 / 番茄控制'),
  ];
  // Carousel is only visible in the idle branch, so drive the interval off
  // the same condition — saves a setInterval in every busy/celebrate state.
  const carouselActive = hovered && e === 'idle';
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    if (!carouselActive) {
      setTipIndex(0);
      return;
    }
    setTipIndex(0);
    const id = setInterval(() => setTipIndex((i) => (i + 1) % tips.length), 2500);
    return () => clearInterval(id);
  }, [carouselActive, tips.length]);

  // Base bubble style: pure text. Keep it visually light around the pet.
  const bubbleStyle: CSSProperties = {
    maxWidth: 240,
    textAlign: 'center',
    color: textPalette.primary,
    WebkitTextFillColor: textPalette.primary,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 13,
    fontWeight: 760,
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
    wordBreak: 'normal',
    whiteSpace: 'normal',
    textShadow: 'none',
    WebkitTextStroke: 'initial',
    filter: 'none',
    opacity: 1,
  };

  let body: ReactNode = null;
  let bubbleKey = '';

  if (dragging) {
    bubbleKey = 'dragging';
    body = <span style={{ fontWeight: 600 }}>{t('pet.hint.moving', '移动中…')}</span>;
  } else if (e === 'rapidSwallow') {
    bubbleKey = 'rapid-swallow';
    body = (
      <span style={{ fontWeight: 700, color: 'inherit', fontSize: 12.5 }}>
        {t('pet.status.rapidSwallow', STATUS_LABEL.rapidSwallow)}
      </span>
    );
  } else if (e === 'swallow') {
    bubbleKey = 'swallow';
    body = (
      <span style={{ fontWeight: 700, color: 'inherit', fontSize: 12.5 }}>
        {t('pet.status.swallow', '嚼嚼嚼…')}
      </span>
    );
  } else if (e === 'overdrag' || e === 'drag') {
    // Drag-state bubble: shows file kind icon + count + the "expecting" caption.
    // overdrag is the escalated variant (mouth wider, cheeks blush) — the icon
    // and caption swap to convey "I'm right here, drop it!".
    const d = state.drag;
    const DragIcon = d ? dragMeta.icon(d.kind) : null;
    const iconColor = d ? dragMeta.color(d.kind) : emotionColor[e];
    const captionKey =
      e === 'overdrag'
        ? d?.kind === 'image'
          ? 'pet.hint.overdrag.image'
          : d?.kind === 'archive'
          ? 'pet.hint.overdrag.archive'
          : d?.kind === 'folder'
          ? 'pet.hint.overdrag.folder'
          : 'pet.hint.overdrag'
        : 'pet.hint.drag';
    const captionFallback =
      e === 'overdrag'
        ? d?.kind === 'image'
          ? '看到图片啦!'
          : d?.kind === 'archive'
          ? '来,打包都给你!'
          : d?.kind === 'folder'
          ? '整个文件夹?'
          : '放下就开吃!'
        : '准备好接收…';
    bubbleKey = `drag-${e}-${d?.kind ?? 'none'}-${d?.count ?? 0}`;
    body = (
      <span
        style={{
          fontWeight: 700,
          color: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 12.5,
        }}
      >
        {DragIcon && <DragIcon size={13} strokeWidth={2.4} style={{ flexShrink: 0, color: iconColor }} />}
        <span>{t(captionKey, captionFallback)}</span>
        {d && d.count > 1 && (
          <span style={{ fontSize: 10.5, opacity: 0.75, fontWeight: 500 }}>
            × {d.count}
          </span>
        )}
      </span>
    );
  } else if (state.setup) {
    bubbleKey = `setup-${e}`;
    const title = state.taskLabel || t('setup.settingUp', '正在配置 JunQi Desktop');
    const detail = isSameStatusCopy(state.message, title) ? '' : (state.message || label);
    const progress = typeof state.progress === 'number' && state.progress > 0 && state.progress < 100
      ? `${Math.round(state.progress)}%`
      : null;
    body = (
      <>
        <span
          style={{
            display: 'inline-block',
            fontWeight: 750,
            color: e === 'error' ? textPalette.danger : textPalette.primary,
            WebkitTextFillColor: e === 'error' ? textPalette.danger : textPalette.primary,
            maxWidth: 232,
            textShadow: 'none',
            WebkitTextStroke: 'initial',
          }}
        >
          {title}
          {progress && <span style={{ marginLeft: 4, fontSize: 10.5, fontWeight: 700 }}>{progress}</span>}
        </span>
        {detail && (
          <div
            style={{
              fontSize: 11.5,
              maxWidth: 230,
              marginTop: 3,
              fontWeight: 620,
              lineHeight: 1.46,
              whiteSpace: 'pre-line',
              overflowWrap: 'anywhere',
              wordBreak: 'normal',
              color: textPalette.secondary,
              WebkitTextFillColor: textPalette.secondary,
              textShadow: 'none',
              WebkitTextStroke: 'initial',
            }}
          >
            {formatStatusDetail(detail)}
          </div>
        )}
      </>
    );
  } else if (e === 'error') {
    bubbleKey = 'error';
    body = <span style={{ fontWeight: 760, color: textPalette.danger }}>{label}</span>;
  } else if (ACTIVE.has(e)) {
    bubbleKey = `active-${e}`;
    const detail = state.message || state.taskLabel;
    const elapsed = state.elapsedMs ? fmtDuration(state.elapsedMs) : null;
    body = (
      <>
        <span style={{ fontWeight: 700, color: 'inherit' }}>
          {label}
          {elapsed && <span style={{ fontSize: 10.5, opacity: 0.65, fontWeight: 400 }}> · {elapsed}</span>}
        </span>
        {detail && (
          <div
            style={{
              fontSize: 10.5,
              maxWidth: 220,
              marginTop: 1,
              fontWeight: 520,
              lineHeight: 1.42,
              whiteSpace: 'pre-line',
              overflowWrap: 'anywhere',
              wordBreak: 'normal',
              color: 'inherit',
              opacity: 0.92,
            }}
          >
            {formatStatusDetail(detail)}
          </div>
        )}
      </>
    );
  } else if (e === 'happy' || e === 'celebrate') {
    // A finished pomodoro phase shows its own caption (+ an icon) instead of
    // the generic one.
    bubbleKey = `celebrate-${state.celebrateKind ?? 'task'}`;
    const pomoKind = e === 'celebrate' && state.celebrateKind && state.celebrateKind !== 'task' ? state.celebrateKind : null;
    const caption = pomoKind ? t(CELEBRATE_CAPTION[pomoKind].key, CELEBRATE_CAPTION[pomoKind].fallback) : label;
    const CelebrateIcon = pomoKind ? celebrateIcon(pomoKind) : null;
    body = (
      <span style={{ fontWeight: 700, color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {CelebrateIcon && <CelebrateIcon size={13} strokeWidth={2.2} style={{ flexShrink: 0 }} />}
        {caption}
      </span>
    );
  } else if (state.pomodoro?.enabled && state.pomodoro.running) {
    // Live countdown — shown only when the pet isn't busy with chat or celebrating.
    // Key excludes phase (work→break only changes color, not the bubble identity)
    // so AnimatePresence doesn't re-trigger the whole fade when the phase switches.
    // Only 'run'/'paused' is in the key — the label + icon are always rendered.
    const p = state.pomodoro;
    bubbleKey = `pomo-${p.paused ? 'paused' : 'run'}`;
    const phaseLabel = p.paused
      ? t('pet.pomodoro.paused', '已暂停')
      : t(p.phase === 'work' ? 'pet.pomodoro.focusing' : 'pet.pomodoro.resting', p.phase === 'work' ? '专注中' : '休息中');
    const PomoIcon = pomodoroIcon(p);
    body = (
      <span style={{ fontWeight: 700, color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <PomoIcon size={13} strokeWidth={2.2} style={{ flexShrink: 0, color: pomodoroColor(p, isDark) }} />
        {p.paused ? phaseLabel : `${phaseLabel} ${fmtClock(p.remainingMs)}`}
      </span>
    );
  } else if (e === 'sleep' || e === 'sleepy') {
    bubbleKey = e;
    body = <span style={{ fontWeight: 700, opacity: 1, color: 'inherit' }}>{label}</span>;
  } else if (hovered) {
    bubbleKey = 'tips';
    body = (
      // Cross-fade between tips — old tip fades out as new one fades in,
      // so the carousel never "snaps". Y stays at 0 so the line position
      // doesn't bob while the user reads.
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={tipIndex}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeInOut' }}
          style={{ display: 'block', fontWeight: 600 }}
        >
          {tips[tipIndex]}
        </motion.span>
      </AnimatePresence>
    );
  } else {
    // idle & not hovered — no bubble.
    bubbleKey = 'idle';
    body = null;
  }

  return (
    <AnimatePresence>
      {body && (
        <motion.div
          key={bubbleKey}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          style={bubbleStyle}
        >
          {body}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
