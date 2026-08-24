import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, FileArchive, FileCode2, FileText, FolderOpen, type LucideIcon } from 'lucide-react';
import type { PetEmotion, PetState } from './pet-states';
import type { DragKind } from '@/stores/petStore';
import { pomodoroIcon, pomodoroColor, celebrateIcon, CELEBRATE_CAPTION } from './pomodoroView';
import { normalizePetThemeName, petCaptionTextContainerStyle, resolvePetAccentPalette, resolvePetDarkMode, resolvePetTextPalette, solidPetTextStyle, type PetThemeName } from './petTheme';
import { usePetStore } from '@/stores/petStore';

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
function useEmotionColor(themeName: PetThemeName): Record<PetEmotion, string> {
  const petAccent = resolvePetAccentPalette(themeName);
  return {
    idle: 'rgb(var(--aegis-text-dim))',
    thinking: petAccent.primary,
    typing: petAccent.secondary,
    tool: petAccent.primary,
    working: petAccent.warning,
    happy: petAccent.success,
    celebrate: petAccent.success,
    error: 'rgb(var(--aegis-danger))',
    sleepy: 'rgb(var(--aegis-text-dim))',
    sleep: 'rgb(var(--aegis-text-muted))',
    memory: petAccent.warm,
    drag: petAccent.primary,
    overdrag: petAccent.secondary,
    swallow: petAccent.secondary,
    rapidSwallow: petAccent.warning,
  };
}

/** Map a drag payload kind to the icon + colour used in the drag bubble.
 *  Falls back to a generic file icon when classification is ambiguous. */
function useDragKindMeta(themeName: PetThemeName) {
  const petAccent = resolvePetAccentPalette(themeName);
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
        case 'image': return petAccent.secondary;
        case 'archive': return petAccent.warning;
        case 'code': return petAccent.primary;
        case 'text': return 'rgb(var(--aegis-text-dim))';
        case 'folder': return petAccent.success;
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

/** Resolve the pet webview's actual applied theme, not the main window store.
 * The pet is a separate webview, so its Zustand settings state can lag behind
 * the `data-theme` token that was already applied to this document. */
function useResolvedPetTheme(): { themeName: PetThemeName; isDark: boolean } {
  const readTheme = () => {
    if (typeof document === 'undefined') return { themeName: 'aegis-dark' as PetThemeName, isDark: true };
    const theme = document.documentElement.getAttribute('data-theme');
    const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
    return {
      themeName: normalizePetThemeName(theme, systemDark),
      isDark: resolvePetDarkMode(theme, systemDark),
    };
  };
  const [resolved, setResolved] = useState(readTheme);
  useEffect(() => {
    const refresh = () => setResolved(readTheme());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', refresh);
    refresh();
    return () => {
      observer.disconnect();
      mq?.removeEventListener('change', refresh);
    };
  }, []);
  return resolved;
}

/**
 * 角色上方的紧凑状态标题使用主题表面承载文字，避免透明窗口与壁纸叠加后失去可读性。
 *
 * 展示优先级从高到低：拖动、错误、对话活动、完成、番茄倒计时、休息、悬停提示和空闲。
 *
 * `bubbleKey` 跟随标题的逻辑类型，类型变化时淡入淡出，同类型更新不重启动效。
 */
export function PetBubble({ state, dragging, hovered, mainWindowActivationFailed }: {
  state: PetState;
  dragging?: boolean;
  hovered?: boolean;
  mainWindowActivationFailed?: boolean;
}) {
  const { t } = useTranslation();
  const { themeName, isDark } = useResolvedPetTheme();
  const emotionColor = useEmotionColor(themeName);
  const dragMeta = useDragKindMeta(themeName);
  const captionScale = usePetStore((store) => store.captionScale);
  const e = state.emotion;
  const label = t(`pet.status.${e}`, STATUS_LABEL[e]);
  const textPalette = resolvePetTextPalette(themeName);
  const readableText = (color: string) => solidPetTextStyle(color);

  // 操作提示只在空闲悬停时轮播，短文案必须能在固定宠物窗口内保持单行。
  const tips = [
    t('pet.hint.tip1', '点击打开'),
    t('pet.hint.tip2', '按住拖动'),
    t('pet.hint.tip3', '托盘显示'),
    t('pet.hint.tip4', '右键菜单'),
  ];
  // 轮播计时器与实际可见条件一致，忙碌状态不创建无效定时器。
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

  // 标题底座必须不透明，文字只依赖当前主题令牌，不再依赖桌面背景采样。
  const captionStyle: CSSProperties = {
    textAlign: 'center',
    ...petCaptionTextContainerStyle(textPalette.primary, captionScale),
  };

  let body: ReactNode = null;
  let bubbleKey = '';

  if (mainWindowActivationFailed) {
    bubbleKey = 'main-window-activation-failed';
    body = (
      <span
        title={t('pet.hint.openFailed', '无法打开主窗口，请从托盘重试')}
        style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 650, ...readableText(textPalette.danger) }}
      >
        {t('pet.hint.openFailedShort', '打开失败')}
      </span>
    );
  } else if (dragging) {
    bubbleKey = 'dragging';
    body = <span style={{ fontWeight: 600, ...readableText(textPalette.primary) }}>{t('pet.hint.moving', '移动中…')}</span>;
  } else if (e === 'rapidSwallow') {
    bubbleKey = 'rapid-swallow';
    body = (
      <span style={{ fontWeight: 700, fontSize: 12.5, ...readableText(textPalette.primary) }}>
        {t('pet.status.rapidSwallow', STATUS_LABEL.rapidSwallow)}
      </span>
    );
  } else if (e === 'swallow') {
    bubbleKey = 'swallow';
    body = (
      <span style={{ fontWeight: 700, fontSize: 12.5, ...readableText(textPalette.primary) }}>
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
          ...readableText(textPalette.primary),
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
    const progress = typeof state.progress === 'number' && state.progress > 0 && state.progress < 100
      ? `${Math.round(state.progress)}%`
      : null;
    body = (
      <span
        title={state.message || title}
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          maxWidth: '100%',
          fontWeight: 700,
          ...readableText(e === 'error' ? textPalette.danger : textPalette.primary),
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        {progress && <span style={{ flexShrink: 0, marginLeft: 4, fontSize: 10.5, fontWeight: 700 }}>{progress}</span>}
      </span>
    );
  } else if (e === 'error') {
    bubbleKey = 'error';
    body = <span style={{ fontWeight: 760, ...readableText(textPalette.danger) }}>{label}</span>;
  } else if (ACTIVE.has(e)) {
    bubbleKey = `active-${e}`;
    const detail = state.message || state.taskLabel;
    const elapsed = state.elapsedMs ? fmtDuration(state.elapsedMs) : null;
    body = (
      <span title={detail} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700, ...readableText(textPalette.primary) }}>
        {label}
        {elapsed && <span style={{ fontSize: 10.5, opacity: 0.65, fontWeight: 400 }}> · {elapsed}</span>}
      </span>
    );
  } else if (e === 'happy' || e === 'celebrate') {
    // 番茄阶段完成时使用对应图标和标题，不叠加通用完成文案。
    bubbleKey = `celebrate-${state.celebrateKind ?? 'task'}`;
    const pomoKind = e === 'celebrate' && state.celebrateKind && state.celebrateKind !== 'task' ? state.celebrateKind : null;
    const caption = pomoKind ? t(CELEBRATE_CAPTION[pomoKind].key, CELEBRATE_CAPTION[pomoKind].fallback) : label;
    const CelebrateIcon = pomoKind ? celebrateIcon(pomoKind) : null;
    body = (
      <span style={{ fontWeight: 700, ...readableText(textPalette.primary), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {CelebrateIcon && <CelebrateIcon size={13} strokeWidth={2.2} style={{ flexShrink: 0 }} />}
        {caption}
      </span>
    );
  } else if (state.pomodoro?.enabled && state.pomodoro.running) {
    // 倒计时只在非忙碌状态展示，键值仅区分运行与暂停，避免阶段切换重启动效。
    const p = state.pomodoro;
    bubbleKey = `pomo-${p.paused ? 'paused' : 'run'}`;
    const phaseLabel = p.paused
      ? t('pet.pomodoro.paused', '已暂停')
      : t(p.phase === 'work' ? 'pet.pomodoro.focusing' : 'pet.pomodoro.resting', p.phase === 'work' ? '专注中' : '休息中');
    const PomoIcon = pomodoroIcon(p);
    body = (
      <span
        data-pet-pomodoro-status
        style={{
          display: 'inline-grid',
          gridTemplateColumns: '14px minmax(0, 1fr)',
          alignItems: 'center',
          columnGap: 5,
          maxWidth: 104,
          ...readableText(textPalette.primary),
        }}
      >
        <PomoIcon
          size={14}
          strokeWidth={2.2}
          aria-hidden="true"
          style={{ color: pomodoroColor(p, isDark) }}
        />
        <span
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            textAlign: 'start',
            lineHeight: 1.12,
          }}
        >
          <span style={{ fontSize: 10.5, fontWeight: 650, whiteSpace: 'normal' }}>
            {phaseLabel}
          </span>
          <span
            style={{
              marginTop: 1,
              fontSize: 13,
              fontWeight: 760,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {fmtClock(p.remainingMs)}
          </span>
        </span>
      </span>
    );
  } else if (e === 'sleep' || e === 'sleepy') {
    bubbleKey = e;
    body = <span style={{ fontWeight: 700, opacity: 1, ...readableText(textPalette.primary) }}>{label}</span>;
  } else if (hovered) {
    bubbleKey = 'tips';
    body = (
      // 提示仅做透明度切换，保持单行基线稳定。
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={tipIndex}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeInOut' }}
          style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, ...readableText(textPalette.primary) }}
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
          style={captionStyle}
        >
          {body}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
