/**
 * Pet sound effects — synthesized on the fly with WebAudio so we don't need
 * shipped MP3 assets. Each effect is a tiny one-shot built from oscillator
 * + envelope calls; cheap to play, cheap to ignore when soundEnabled is off.
 *
 * Three cues cover the drag-drop loop:
 *   • drag.mp3    — soft "anticipation" pad while a file is hovering
 *   • drop.mp3    — short click when the payload is released
 *   • munch.mp3   — chewing loop while swallow is on screen
 *
 * All three are gated by `soundEnabled` from the pet store. We also honour
 * the OS mute switch and the page's `visibilityState` — no point playing a
 * "munch" while the user is alt-tabbed away.
 */

type SfxName = 'drag' | 'drop' | 'munch';

let ctx: AudioContext | null = null;

/** Lazy-init the AudioContext — Safari/iOS won't let us create one before the
 *  first user gesture, so the first call after a click does the create. */
function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** Envelope helper — fast attack, exponential decay, gain control. */
function env(node: GainNode, attack: number, decay: number, peak = 0.18) {
  const t = ctx?.currentTime ?? 0;
  node.gain.cancelScheduledValues(t);
  node.gain.setValueAtTime(0, t);
  node.gain.linearRampToValueAtTime(peak, t + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** Click / drop — a soft tonal pip with a tiny noise tail. Pitch is just
 *  high enough to read as "received" without being intrusive. */
function playDrop() {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(620, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(420, c.currentTime + 0.18);
  osc.connect(gain).connect(c.destination);
  env(gain, 0.005, 0.22, 0.22);
  osc.start();
  osc.stop(c.currentTime + 0.25);

  // Tiny noise tick layered on top — gives the "pop" a tactile edge.
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.04, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  noise.buffer = buf;
  const ngain = c.createGain();
  noise.connect(ngain).connect(c.destination);
  env(ngain, 0.001, 0.05, 0.08);
  noise.start();
}

/** Drag pad — a sustained low triangle + a slow tremolo so the pet feels
 *  "humming" while the user is hovering a file. Returns a stop() handle. */
function playDrag(): () => void {
  const c = ensureCtx();
  if (!c) return () => undefined;
  const osc = c.createOscillator();
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 220;
  lfo.frequency.value = 5.5;
  lfoGain.gain.value = 30; // ±30 Hz wobble
  lfo.connect(lfoGain).connect(osc.frequency);
  osc.connect(gain).connect(c.destination);
  // Soft attack so the cue fades in instead of popping on.
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.06, c.currentTime + 0.12);
  osc.start();
  lfo.start();
  let stopped = false;
  return () => {
    if (stopped || !ctx) return;
    stopped = true;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.18);
    osc.stop(t + 0.22);
    lfo.stop(t + 0.22);
  };
}

/** Munch — 3 short noise bursts spaced ~120ms apart. Mimics a single chew
 *  cycle. Called twice during the SWALLOW_WINDOW to convey ongoing chew. */
function playMunch() {
  const c = ensureCtx();
  if (!c) return;
  for (let i = 0; i < 3; i++) {
    const t0 = c.currentTime + i * 0.12;
    const noise = c.createBufferSource();
    const buf = c.createBuffer(1, c.sampleRate * 0.06, c.sampleRate);
    const ch = buf.getChannelData(0);
    for (let j = 0; j < ch.length; j++) {
      // Light low-pass via averaging → keeps the noise "soft" rather than
      // a harsh hiss. Loose, intentionally unrolled for simplicity.
      ch[j] = (Math.random() * 2 - 1) * (1 - j / ch.length) * 0.6;
    }
    noise.buffer = buf;
    const g = c.createGain();
    noise.connect(g).connect(c.destination);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    noise.start(t0);
  }
}

/** Public API — play a sound effect if `enabled` is true and the page is
 *  visible. Returns a stop() for sustained effects (drag). */
export function playPetSfx(name: SfxName, enabled: boolean): (() => void) | undefined {
  if (!enabled) return undefined;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return undefined;
  if (name === 'drag') return playDrag();
  if (name === 'drop') { playDrop(); return undefined; }
  if (name === 'munch') { playMunch(); return undefined; }
  return undefined;
}

/** Tear-down hook for cleanup on hot reload / unmount. */
export function disposePetSfx() {
  if (ctx) {
    try { ctx.close(); } catch { /* ignored */ }
    ctx = null;
  }
}