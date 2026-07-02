/**
 * PetBreakOverlay — shown in the main window when a Pomodoro break is active.
 * Enlarges the pet, centers it, shows a countdown + progress, floating particles,
 * animated Zzz, and buttons to close (keep timer) or skip the break.
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Coffee, Star, Moon, SkipForward, Sparkles, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePetStore } from '@/stores/petStore';
import { PetCharacter } from './PetCharacter';

function fmtClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const m = Math.floor(clamped / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Fixed positions/timings so no Math.random() on each render
const PARTICLES: Array<{ Icon: LucideIcon; left: string; delay: number; dur: number; size: number; opacity: number }> = [
  { Icon: Coffee,   left: '7%',  delay: 0,    dur: 5.4, size: 18, opacity: 0.18 },
  { Icon: Star,     left: '19%', delay: 1.3,  dur: 3.9, size: 13, opacity: 0.24 },
  { Icon: Moon,     left: '33%', delay: 2.6,  dur: 6.1, size: 15, opacity: 0.16 },
  { Icon: Coffee,   left: '50%', delay: 0.6,  dur: 4.7, size: 19, opacity: 0.19 },
  { Icon: Sparkles, left: '64%', delay: 1.8,  dur: 5.3, size: 14, opacity: 0.21 },
  { Icon: Star,     left: '76%', delay: 3.1,  dur: 4.0, size: 12, opacity: 0.26 },
  { Icon: Moon,     left: '87%', delay: 0.9,  dur: 5.8, size: 16, opacity: 0.17 },
  { Icon: Coffee,   left: '44%', delay: 2.2,  dur: 3.6, size: 13, opacity: 0.23 },
];

export function PetBreakOverlay() {
  const { t } = useTranslation();
  const petEnabled = usePetStore(s => s.enabled);
  const pomodoro   = usePetStore(s => s.pomodoro);
  const setPomodoro = usePetStore(s => s.setPomodoro);
  const skin       = usePetStore(s => s.skin);
  const customAsset = usePetStore(s => s.customAsset);

  const isBreak = petEnabled && pomodoro.enabled && pomodoro.running && pomodoro.phase === 'break';

  // Dismissed flag resets every time a new break session begins (lastDoneTs changes
  // while phase is 'break' → work→break transition).
  const [dismissed, setDismissed] = useState(false);
  const prevDoneTs = useRef(pomodoro.lastDoneTs);
  useEffect(() => {
    if (pomodoro.lastDoneTs !== prevDoneTs.current) {
      prevDoneTs.current = pomodoro.lastDoneTs;
      if (pomodoro.phase === 'break' && pomodoro.running) {
        setDismissed(false);
      }
    }
  }, [pomodoro.lastDoneTs, pomodoro.phase, pomodoro.running]);

  // Live countdown (500ms tick — smoother than 1s without wasting frames)
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => {
    if (!isBreak) return;
    const tick = () => {
      if (pomodoro.paused) {
        setRemainingMs(Math.max(0, pomodoro.pausedRemainingMs ?? 0));
      } else {
        setRemainingMs(Math.max(0, (pomodoro.endsAt ?? Date.now()) - Date.now()));
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [isBreak, pomodoro.endsAt, pomodoro.paused, pomodoro.pausedRemainingMs]);

  const isLongBreak = pomodoro.workRounds > 0 && pomodoro.workRounds % 4 === 0;
  const totalMs     = (isLongBreak ? pomodoro.longBreakMin : pomodoro.breakMin) * 60_000;
  const progressPct = totalMs > 0 ? Math.min(100, ((totalMs - remainingMs) / totalMs) * 100) : 0;

  const skipBreak = () => {
    const now = Date.now();
    const resetCycle = pomodoro.workRounds > 0 && pomodoro.workRounds % 4 === 0;
    setPomodoro({
      phase: 'work',
      endsAt: now + pomodoro.workMin * 60_000,
      lastDoneTs: now,
      workRounds: resetCycle ? 0 : pomodoro.workRounds,
    });
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      {isBreak && !dismissed && (
        <motion.div
          key="pet-break"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="fixed inset-0 z-[8500] flex items-center justify-center overflow-hidden"
          style={{ background: 'rgba(var(--aegis-bg), 0.88)', backdropFilter: 'blur(20px) saturate(1.3)' }}
        >
          {/* ── Floating background particles ── */}
          {PARTICLES.map((p, i) => {
            const Icon = p.Icon;
            return (
              <motion.div
                key={i}
                style={{ position: 'absolute', left: p.left, bottom: '-32px', pointerEvents: 'none' }}
                animate={{ y: [0, -1300] }}
                transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: 'linear', repeatDelay: 0.3 }}
              >
                <Icon size={p.size} style={{ color: 'rgb(var(--aegis-primary))', opacity: p.opacity }} />
              </motion.div>
            );
          })}

          {/* ── Central card ── */}
          <motion.div
            initial={{ scale: 0.84, y: 28, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.88, y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26, delay: 0.06 }}
            className="relative flex flex-col items-center"
            style={{
              background: 'linear-gradient(158deg, rgba(var(--aegis-surface-elevated),0.97), rgba(var(--aegis-surface),0.92))',
              border: '1px solid rgba(var(--aegis-overlay),0.13)',
              boxShadow: '0 28px 72px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.06)',
              borderRadius: 28,
              padding: '40px 52px 32px',
              minWidth: 308,
              gap: 0,
            }}
          >
            {/* Close */}
            <button
              onClick={() => setDismissed(true)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/40 transition-colors"
              title={t('common.close', '关闭')}
            >
              <X size={15} />
            </button>

            {/* Phase label + countdown */}
            <div className="text-center mb-5">
              <p className="text-[10.5px] font-semibold tracking-widest uppercase mb-2"
                style={{ color: 'rgba(var(--aegis-text-muted),0.9)' }}>
                {isLongBreak
                  ? t('pet.pomodoro.longBreak', '长休息')
                  : t('pet.pomodoro.shortBreak', '短休息')}
              </p>
              <motion.div
                className="text-[44px] font-mono font-bold tabular-nums leading-none"
                style={{ color: 'rgb(var(--aegis-primary))' }}
                animate={{ opacity: pomodoro.paused ? [1, 0.45, 1] : 1 }}
                transition={{ duration: 1.1, repeat: pomodoro.paused ? Infinity : 0 }}
              >
                {fmtClock(remainingMs)}
              </motion.div>
              {pomodoro.paused && (
                <p className="text-[11px] mt-1" style={{ color: 'rgba(var(--aegis-text-dim),0.8)' }}>
                  {t('pet.pomodoro.paused', '已暂停')}
                </p>
              )}
            </div>

            {/* Enlarged pet — 2.2× scale, sleep pose */}
            <div style={{ position: 'relative', width: 96, height: 110, transform: 'scale(2.2)', transformOrigin: 'center', margin: '16px 0 60px' }}>
              <PetCharacter emotion="sleep" progress={0} skin={skin} customAsset={customAsset} />
              {/* Zzz floats upward from above the pet's head */}
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: -8,
                    fontSize: 10 + i * 3,
                    fontWeight: 700,
                    color: 'rgb(var(--aegis-primary))',
                    opacity: 0,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                  animate={{ opacity: [0, 0.7, 0], y: [0, -28 - i * 12], x: [0, 6 + i * 5] }}
                  transition={{ duration: 2.4, delay: i * 0.75 + 0.5, repeat: Infinity, ease: 'easeOut', repeatDelay: 0.6 }}
                >
                  z
                </motion.span>
              ))}
            </div>

            {/* Progress bar */}
            <div style={{ width: '100%', maxWidth: 224, marginBottom: 10 }}>
              <div className="h-1.5 rounded-full overflow-hidden"
                style={{ background: 'rgba(var(--aegis-overlay),0.1)' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'rgb(var(--aegis-primary))' }}
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: 0.5, ease: 'linear' }}
                />
              </div>
              <p className="text-[10px] text-center mt-1.5" style={{ color: 'rgba(var(--aegis-text-dim),0.75)' }}>
                {t('pet.pomodoro.breakHint', '好好休息一下，待会更有状态 ✨')}
              </p>
            </div>

            {/* Skip */}
            <button
              onClick={skipBreak}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11.5px] text-aegis-text-muted hover:text-aegis-text transition-colors mt-1"
              style={{ border: '1px solid rgba(var(--aegis-overlay),0.16)' }}
            >
              <SkipForward size={12} />
              {t('pet.pomodoro.skipBreak', '跳过休息')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
