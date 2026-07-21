import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, rm } from 'node:fs/promises';

export class StableFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StableFileError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new StableFileError(code, message);
}

export function fileIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

export function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

export async function readStableFile(filePath, expectedStat = undefined, maxBytes = undefined) {
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || (expectedStat && !sameFileIdentity(openedStat, fileIdentity(expectedStat)))) {
      fail('FILE_CHANGED', `Regular file identity changed before reading: ${filePath}`);
    }
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
      fail('INVALID_LIMIT', 'Stable file read limit must be a non-negative safe integer');
    }
    const chunks = [];
    let bytesRead = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      bytesRead += chunk.byteLength;
      if (bytesRead > openedStat.size) fail('FILE_CHANGED', `Regular file grew while reading: ${filePath}`);
      if (maxBytes !== undefined && bytesRead > maxBytes) fail('FILE_TOO_LARGE', `Stable file exceeds the configured read limit: ${filePath}`);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const finalStat = await handle.stat();
    if (!sameFileIdentity(finalStat, fileIdentity(openedStat))) {
      fail('FILE_CHANGED', `Regular file changed while reading: ${filePath}`);
    }
    return { bytes, stat: finalStat };
  } finally {
    await handle?.close();
  }
}

export async function hashStableFile(filePath, expectedStat = undefined) {
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || (expectedStat && !sameFileIdentity(openedStat, fileIdentity(expectedStat)))) {
      fail('FILE_CHANGED', `Regular file identity changed before hashing: ${filePath}`);
    }
    const digest = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      if (bytes + chunk.byteLength > openedStat.size) fail('FILE_CHANGED', `Regular file grew while hashing: ${filePath}`);
      digest.update(chunk);
      bytes += chunk.byteLength;
    }
    const finalStat = await handle.stat();
    if (!sameFileIdentity(finalStat, fileIdentity(openedStat))) {
      fail('FILE_CHANGED', `Regular file changed while hashing: ${filePath}`);
    }
    return { bytes, sha256: digest.digest('hex'), stat: finalStat };
  } finally {
    await handle?.close();
  }
}

async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new StableFileError('WRITE_FAILED', 'Unable to make progress while writing a stable file');
    }
    offset += bytesWritten;
  }
}

/**
 * Stream a discovered regular file into a new destination while binding the
 * copy to the source file descriptor identity. This is the large-artifact
 * counterpart to readStableFile and avoids an installer-sized heap allocation.
 */
export async function copyStableFile(filePath, destinationPath, expectedStat, mode = 0o600) {
  let sourceHandle;
  let destinationHandle;
  let removePartial = false;
  try {
    sourceHandle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedStat = await sourceHandle.stat();
    if (!openedStat.isFile() || (expectedStat && !sameFileIdentity(openedStat, fileIdentity(expectedStat)))) {
      fail('FILE_CHANGED', `Regular file identity changed before copying: ${filePath}`);
    }
    destinationHandle = await open(
      destinationPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      mode,
    );
    removePartial = true;
    const digest = createHash('sha256');
    let bytes = 0;
    for await (const chunk of sourceHandle.createReadStream({ autoClose: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes + buffer.byteLength > openedStat.size) fail('FILE_CHANGED', `Regular file grew while copying: ${filePath}`);
      await writeAll(destinationHandle, buffer);
      digest.update(buffer);
      bytes += buffer.byteLength;
    }
    const finalSourceStat = await sourceHandle.stat();
    if (!sameFileIdentity(finalSourceStat, fileIdentity(openedStat))) {
      fail('FILE_CHANGED', `Regular file changed while copying: ${filePath}`);
    }
    await destinationHandle.sync();
    const destinationStat = await destinationHandle.stat();
    if (!destinationStat.isFile() || destinationStat.size !== bytes) {
      fail('WRITE_FAILED', `Stable file copy size verification failed: ${destinationPath}`);
    }
    removePartial = false;
    return {
      bytes,
      sha256: digest.digest('hex'),
      sourceStat: finalSourceStat,
      destinationStat,
    };
  } finally {
    await destinationHandle?.close();
    await sourceHandle?.close();
    if (removePartial) await rm(destinationPath, { force: true }).catch(() => undefined);
  }
}

export async function writeNewRegularFile(filePath, bytes, mode = 0o644) {
  let handle;
  let removePartial = false;
  try {
    handle = await open(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      mode,
    );
    removePartial = true;
    await handle.writeFile(bytes);
    removePartial = false;
  } catch (error) {
    throw error;
  } finally {
    await handle?.close();
    if (removePartial) await rm(filePath, { force: true }).catch(() => undefined);
  }
}
