import { appDataDir } from '@tauri-apps/api/path';
import { exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { startVoiceRecording, stopVoiceRecording } from '@/api/tauri-commands';
import { voiceSessionDirectory } from '@/services/chat/voiceStoragePath';

async function sessionDirectory(sessionKey?: string): Promise<string> {
  return voiceSessionDirectory(await appDataDir(), sessionKey);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export const voiceFileRuntime = {
  startRecording: startVoiceRecording,
  stopRecording: stopVoiceRecording,
  async save(sessionKey: string | undefined, name: string, base64: string): Promise<string | null> {
    try {
      const directory = await sessionDirectory(sessionKey);
      await mkdir(directory, { recursive: true });
      const path = `${directory}/${name}`;
      await writeFile(path, Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
      return path;
    } catch { return null; }
  },
  async read(path: string): Promise<string | null> {
    try { return toBase64(await readFile(path)); } catch { return null; }
  },
  async cleanupSession(sessionKey: string): Promise<{ success: boolean; removed: boolean }> {
    try {
      const directory = await sessionDirectory(sessionKey);
      if (!await exists(directory)) return { success: true, removed: false };
      await remove(directory, { recursive: true });
      return { success: true, removed: true };
    } catch { return { success: false, removed: false }; }
  },
};
