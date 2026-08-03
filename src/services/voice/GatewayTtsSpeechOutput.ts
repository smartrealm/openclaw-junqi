import { openClawTtsClient, type OpenClawTtsClip } from '@/services/gateway';

export interface VoiceSpeechOutput {
  speak(text: string, signal: AbortSignal): Promise<void>;
  stop(): void;
}

export interface GatewayTtsSpeaker {
  speak(input: { text: string; signal: AbortSignal }): Promise<OpenClawTtsClip>;
}

interface ActivePlayback {
  readonly audio: HTMLAudioElement;
  readonly cancel: () => void;
}

function audioUrl(clip: OpenClawTtsClip): string {
  if (!clip.mimeType) {
    throw new Error('OpenClaw TTS did not provide a playable MIME type');
  }
  if (typeof atob !== 'function' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('The desktop audio renderer cannot play OpenClaw TTS output');
  }
  try {
    const binary = atob(clip.audioBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: clip.mimeType }));
  } catch {
    throw new Error('OpenClaw TTS returned invalid inline audio');
  }
}

/** Plays only audio synthesized by the currently connected OpenClaw Gateway. */
export class GatewayTtsSpeechOutput implements VoiceSpeechOutput {
  private active: ActivePlayback | null = null;

  constructor(private readonly client: GatewayTtsSpeaker = openClawTtsClient) {}

  async speak(text: string, signal: AbortSignal): Promise<void> {
    const clip = await this.client.speak({ text, signal });
    if (signal.aborted) return;
    if (!clip.mimeType) {
      throw new Error('OpenClaw TTS did not provide a playable MIME type');
    }
    if (typeof Audio === 'undefined') {
      throw new Error('The desktop audio renderer is unavailable');
    }
    const source = audioUrl(clip);
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(source);
      let settled = false;
      const cleanup = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
        URL.revokeObjectURL(source);
        if (this.active?.audio === audio) this.active = null;
      };
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onEnded = () => settle();
      const onError = () => settle(new Error('OpenClaw TTS audio playback failed'));
      const onAbort = () => {
        audio.pause();
        settle();
      };
      const cancel = () => onAbort();

      audio.addEventListener('ended', onEnded, { once: true });
      audio.addEventListener('error', onError, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      this.active = { audio, cancel };
      void audio.play().catch(() => settle(new Error('OpenClaw TTS audio playback was rejected')));
    });
  }

  stop(): void {
    this.active?.cancel();
  }
}
