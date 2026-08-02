// Native capture limits a VAD turn to 15 seconds and polls every 20 ms. Keep
// every frame from one turn while Gateway-side acceptance and Talk setup run,
// without allowing an unbounded resident audio queue.
export const MAX_VOICE_WAKE_PCM_FRAMES = 750;
