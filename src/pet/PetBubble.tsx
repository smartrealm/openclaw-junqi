import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ProgressRing, StatusDot } from '@/components/shared';
import type { PetEmotion, PetState } from './pet-states';

/** Map pet emotions onto the shared StatusDot palette. */
const DOT_STATUS: Record<PetEmotion, 'active' | 'idle' | 'sleeping' | 'error' | 'paused'> = {
  idle: 'idle',
  thinking: 'active',
  typing: 'active',
  working: 'active',
  happy: 'active',
  celebrate: 'active',
  error: 'error',
  sleepy: 'sleeping',
  sleep: 'sleeping',
  memory: 'paused',
};

/**
 * Compact status bubble above the character. Hidden on idle (the pet is just
 * hanging out). Reuses the shared `StatusDot` + `ProgressRing` so it matches
 * the rest of the app's visual language and theme.
 */
export function PetBubble({ state }: { state: PetState }) {
  const { t } = useTranslation();
  const e = state.emotion;

  let title: string | null = null;
  switch (e) {
    case 'thinking':
      title = state.message ? state.message.slice(0, 40) : t('pet.thinking', '思考中…');
      break;
    case 'typing':
      title = t('pet.typing', '正在回复…');
      break;
    case 'working':
      title = state.taskLabel || t('pet.working', '工作中…');
      break;
    case 'happy':
      title = t('pet.done', '完成啦！');
      break;
    case 'celebrate':
      title = t('pet.celebrate', '任务完成 🎉');
      break;
    case 'error':
      title = t('pet.error', '出错了');
      break;
    case 'sleepy':
      title = t('pet.sleepy', '有点困…');
      break;
    case 'sleep':
      title = t('pet.sleep', '休息中');
      break;
    case 'memory':
      title = t('pet.memory', '整理记忆…');
      break;
    default:
      title = null; // idle — no bubble
  }

  const showProgress = (e === 'working' || e === 'typing') && typeof state.progress === 'number';

  return (
    <AnimatePresence>
      {title && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.18 }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: 120,
            padding: '4px 8px',
            borderRadius: 999,
            background: 'rgba(20,24,30,0.9)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#e8eaed',
            fontSize: 10,
            fontFamily: 'system-ui, sans-serif',
            overflow: 'hidden',
          }}
        >
          <StatusDot status={DOT_STATUS[e]} size={6} pulse={e === 'working' || e === 'typing'} />
          {showProgress && <ProgressRing percentage={state.progress ?? 0} size={16} strokeWidth={2.5} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
