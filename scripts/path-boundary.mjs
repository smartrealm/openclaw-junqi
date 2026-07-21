import path from 'node:path';
import { realpath } from 'node:fs/promises';

function sameOrDescendant(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === ''
    || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** Return true when either path contains the other, including equality. */
export function pathsOverlap(leftPath, rightPath) {
  return sameOrDescendant(leftPath, rightPath) || sameOrDescendant(rightPath, leftPath);
}

async function canonicalPath(inputPath) {
  let current = path.resolve(inputPath);
  const suffix = [];
  while (true) {
    try {
      const resolved = await realpath(current);
      return path.join(resolved, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...suffix.reverse());
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

/** Resolve existing symlink ancestors before applying the lexical overlap check. */
export async function pathsOverlapAsync(leftPath, rightPath) {
  const [left, right] = await Promise.all([canonicalPath(leftPath), canonicalPath(rightPath)]);
  return pathsOverlap(left, right);
}
