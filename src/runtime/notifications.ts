import { useNotificationStore, type NotificationType } from '@/stores/notificationStore';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { debugWarn } from '@/utils/debugLog';
import {
  notifyPersistentNotificationsChanged,
  persistentNotificationRepository,
} from '@/services/persistentNotifications';

export interface NotifyOptions {
  type: NotificationType;
  title: string;
  body: string;
  /** 上游事件的稳定身份；没有稳定身份的通知可省略。 */
  dedupeKey?: string;
  /** 通知中心点击后打开的内部或外部目标。 */
  url?: string | null;
}

export function notificationTypeFromPersistentLevel(level: string): NotificationType {
  if (level === 'error' || level === 'warning') return 'error';
  if (level === 'attention') return 'message';
  if (level === 'completed') return 'task_complete';
  return 'info';
}

class NotificationService {
  private static readonly MAX_DEDUPE_KEYS = 512;
  private _enabled = true;
  private _soundEnabled = true;
  private _dndMode = false;
  private nativePermissionRequested = false;
  private readonly deliveredDedupeKeys = new Set<string>();

  private audioCtx: AudioContext | null = null;

  // ── 读取与设置 ────────────────────────────────────────────
  get enabled(): boolean { return this._enabled; }
  set enabled(v: boolean) { this._enabled = v; }

  get soundEnabled(): boolean { return this._soundEnabled; }
  set soundEnabled(v: boolean) { this._soundEnabled = v; }

  get dndMode(): boolean { return this._dndMode; }
  set dndMode(v: boolean) { this._dndMode = v; }

  // 设置页使用的显式写入方法。
  setEnabled(v: boolean) { this._enabled = v; }
  setSoundEnabled(v: boolean) { this._soundEnabled = v; }
  setDndMode(v: boolean) { this._dndMode = v; }

  // ── 声音 ─────────────────────────────────────────────────

  /** 通过 Web Audio API 播放双音提示声。 */
  playChime(): void {
    if (!this._soundEnabled || this._dndMode) return;

    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      const ctx = this.audioCtx;
      const now = ctx.currentTime;

      // 两个频率组成简短提示声。
      const notes = [523.25, 659.25];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.4);
      });
    } catch {
      // AudioContext 不可用时保持静默，不阻断通知。
    }
  }

  // ── 通知主流程 ────────────────────────────────────────────

  notify(options: NotifyOptions): void {
    if (!this._enabled) return;
    if (options.dedupeKey && !this.rememberDedupeKey(options.dedupeKey)) return;
    const present = () => {
      if (this._dndMode) return;
      this.present(options);
    };

    void this.persist(options).then((inserted) => {
      if (inserted) present();
    }).catch(() => {
      // 仅浏览器开发环境可能没有持久化能力，仍保留可见通知。
      present();
    });
  }

  /** 后端已持久化的事件只负责呈现，避免再次写入同一条通知。 */
  presentPersisted(level: string, title: string, body: string): void {
    if (!this._enabled || this._dndMode) return;
    this.present({ type: notificationTypeFromPersistentLevel(level), title, body });
  }

  private rememberDedupeKey(dedupeKey: string): boolean {
    if (this.deliveredDedupeKeys.has(dedupeKey)) return false;
    this.deliveredDedupeKeys.add(dedupeKey);
    if (this.deliveredDedupeKeys.size > NotificationService.MAX_DEDUPE_KEYS) {
      const oldest = this.deliveredDedupeKeys.values().next().value;
      if (oldest) this.deliveredDedupeKeys.delete(oldest);
    }
    return true;
  }

  private persist(options: NotifyOptions): Promise<boolean> {
    const host = window as Window & { __TAURI_INTERNALS__?: unknown };
    if (!host.__TAURI_INTERNALS__) return Promise.resolve(true);
    const level = options.type === 'error'
      ? 'error'
      : options.type === 'task_complete'
        ? 'completed'
        : 'info';
    return persistentNotificationRepository.push({
      level,
      title: options.title,
      body: options.body,
      url: options.url ?? null,
      dedupeKey: options.dedupeKey ?? null,
    }).then((result) => {
      notifyPersistentNotificationsChanged();
      return result.inserted;
    }).catch((error) => {
      debugWarn('notifications', '[Notify] Failed to persist notification:', error);
      throw error;
    });
  }

  private present(options: Pick<NotifyOptions, 'type' | 'title' | 'body'>): void {
    if (document.hasFocus()) {
      this.playChime();
      useNotificationStore.getState().addToast(options.type, options.title, options.body);
      return;
    }
    void this.showNativeNotification(options.title, options.body);
  }

  /** 仅在后台通知或用户主动测试时向系统申请原生通知权限。 */
  private async showNativeNotification(title: string, body: string): Promise<void> {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        if (this.nativePermissionRequested) return;
        this.nativePermissionRequested = true;
        granted = (await requestPermission()) === 'granted';
      }
      if (granted) sendNotification({ title, body });
    } catch (error) {
      debugWarn('notifications', '[Notify] Native delivery failed:', error);
    }
  }

  /** 设置页的主动测试可明确请求系统权限。 */
  testSystemNotification(title: string, body: string): void {
    if (!this._enabled || this._dndMode) return;
    void this.showNativeNotification(title, body);
  }

  // ── 条件通知 ──────────────────────────────────────────────

  /** 返回应用窗口当前是否具有焦点。 */
  isWindowFocused(): boolean {
    return document.hasFocus();
  }

  /** 仅在窗口聚焦时通知。 */
  notifyIfVisible(options: NotifyOptions): void {
    if (this.isWindowFocused()) {
      this.notify(options);
    }
  }

  /** 仅在窗口失去焦点时通知。 */
  notifyIfBackground(options: NotifyOptions): void {
    if (!this.isWindowFocused()) {
      this.notify(options);
    }
  }
}

export const notifications = new NotificationService();
