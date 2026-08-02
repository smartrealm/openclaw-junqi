import { appDataDir } from '@tauri-apps/api/path';
import { exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { startVoiceRecording, stopVoiceRecording } from '@/api/tauri-commands';

function encodePathSegment(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sessionDirectory(sessionKey?: string): Promise<string> {
  const root = `${(await appDataDir()).replace(/[\\/]+$/, '')}/voice`;
  if (!sessionKey) return root;
  const chunks = encodePathSegment(sessionKey).match(/.{1,120}/g) ?? ['_'];
  return `${root}/v1/${chunks.join('/')}/_`;
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
