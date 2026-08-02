/** Encode arbitrary-sized binary data without exceeding JS argument limits. */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Maps a session key to a segment-safe voice directory below an app-owned root.
 * The final marker prevents one encoded key from becoming another key's parent.
 */
export function voiceSessionDirectory(appDataPath: string, sessionKey?: string): string {
  const root = `${appDataPath.replace(/[\\/]+$/, '')}/voice`;
  if (!sessionKey) return root;
  const encoded = bytesToBase64(new TextEncoder().encode(sessionKey))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const chunks = encoded.match(/.{1,120}/g) ?? ['_'];
  return `${root}/v1/${chunks.join('/')}/_`;
}
