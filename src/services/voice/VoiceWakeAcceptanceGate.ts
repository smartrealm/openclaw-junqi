export interface VoiceWakePcmFrame {
  data: string;
  sampleRateHz: number;
  channels: number;
}

export interface VoiceWakeCapturedAudio {
  wavDataUrl: string;
  sessionKey: string | null | undefined;
}

export interface AcceptedVoiceWakeAudio {
  pcmFrames: VoiceWakePcmFrame[];
  capture: VoiceWakeCapturedAudio | null;
}

const MAX_PENDING_PCM_FRAMES = 50;

/** Holds one wake turn's audio until a required Gateway-side mutation confirms. */
export class VoiceWakeAcceptanceGate {
  private pending = false;
  private pcmFrames: VoiceWakePcmFrame[] = [];
  private capture: VoiceWakeCapturedAudio | null = null;

  begin(): void {
    this.pending = true;
    this.pcmFrames = [];
    this.capture = null;
  }

  isPending(): boolean {
    return this.pending;
  }

  retainPcm(frame: VoiceWakePcmFrame): boolean {
    if (!this.pending) return false;
    if (this.pcmFrames.length < MAX_PENDING_PCM_FRAMES) this.pcmFrames.push(frame);
    return true;
  }

  retainCapture(capture: VoiceWakeCapturedAudio): boolean {
    if (!this.pending) return false;
    this.capture = capture;
    return true;
  }

  accept(): AcceptedVoiceWakeAudio {
    const accepted = { pcmFrames: this.pcmFrames, capture: this.capture };
    this.pending = false;
    this.pcmFrames = [];
    this.capture = null;
    return accepted;
  }

  reject(): void {
    this.pending = false;
    this.pcmFrames = [];
    this.capture = null;
  }
}
