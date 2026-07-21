import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RELEASE_ASSET_CATALOG = Object.freeze([
  Object.freeze({
    label: 'Windows x64 NSIS installer',
    pattern: /_x64-setup\.exe$/i,
    signatureRequired: true,
    updaterPlatforms: Object.freeze(['windows-x86_64', 'windows-x86_64-nsis']),
  }),
  Object.freeze({
    label: 'Windows ARM64 NSIS installer',
    pattern: /_arm64-setup\.exe$/i,
    signatureRequired: true,
    updaterPlatforms: Object.freeze(['windows-aarch64', 'windows-aarch64-nsis']),
  }),
  Object.freeze({
    label: 'macOS ARM64 disk image',
    pattern: /_aarch64\.dmg$/i,
    signatureRequired: false,
    updaterPlatforms: Object.freeze([]),
  }),
  Object.freeze({
    label: 'macOS x64 disk image',
    pattern: /_x64\.dmg$/i,
    signatureRequired: false,
    updaterPlatforms: Object.freeze([]),
  }),
  Object.freeze({
    label: 'macOS ARM64 updater',
    pattern: /_aarch64\.app\.tar\.gz$/i,
    signatureRequired: true,
    updaterPlatforms: Object.freeze(['darwin-aarch64', 'darwin-aarch64-app']),
  }),
  Object.freeze({
    label: 'macOS x64 updater',
    pattern: /_x64\.app\.tar\.gz$/i,
    signatureRequired: true,
    updaterPlatforms: Object.freeze(['darwin-x86_64', 'darwin-x86_64-app']),
  }),
]);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }
    values[key.slice(2)] = value;
  }
  for (const required of ['assets-dir', 'repo', 'tag', 'version', 'output']) {
    if (!values[required]) throw new Error(`Missing --${required}`);
  }
  return values;
}

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Release asset must not be a symbolic link: ${path}`);
    if (stat.isDirectory()) {
      paths.push(...await filesRecursively(path));
      continue;
    }
    if (!stat.isFile()) throw new Error(`Release asset must be a regular file: ${path}`);
    paths.push(path);
  }
  return paths;
}

function releaseUrl(repo, tag, filename) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}

async function collectReleaseAssets(paths) {
  const artifacts = paths.filter((path) => !path.endsWith('.sig'));
  const recognized = new Set();
  const selected = [];

  for (const definition of RELEASE_ASSET_CATALOG) {
    const matches = artifacts.filter((path) => definition.pattern.test(basename(path)));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one ${definition.label}, found ${matches.length}`);
    }
    const artifact = matches[0];
    recognized.add(artifact);

    let signature;
    if (definition.signatureRequired) {
      const signaturePath = `${artifact}.sig`;
      if (!paths.includes(signaturePath)) {
        throw new Error(`Missing updater signature for ${artifact}`);
      }
      signature = (await readFile(signaturePath, 'utf8')).trim();
      if (!signature) throw new Error(`Empty updater signature for ${artifact}`);
      recognized.add(signaturePath);
    }
    selected.push({ definition, artifact, signature });
  }

  const unexpected = paths.filter((path) => !recognized.has(path));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected release artifact: ${unexpected.map((path) => basename(path)).join(', ')}`);
  }

  const names = selected.flatMap(({ artifact, definition }) => [
    basename(artifact),
    ...(definition.signatureRequired ? [`${basename(artifact)}.sig`] : []),
  ]);
  if (new Set(names).size !== names.length) {
    throw new Error('Release assets must have unique file names');
  }

  return selected;
}

export async function generateUpdaterManifest(options) {
  const output = resolve(options.output);
  const paths = (await filesRecursively(options.assetsDir)).filter((path) => resolve(path) !== output);
  const releaseAssets = await collectReleaseAssets(paths);
  const platforms = {};
  for (const { definition, artifact, signature } of releaseAssets) {
    if (definition.updaterPlatforms.length === 0) continue;
    const entry = { signature, url: releaseUrl(options.repo, options.tag, basename(artifact)) };
    for (const platform of definition.updaterPlatforms) platforms[platform] = entry;
  }

  const manifest = {
    version: options.version,
    notes: options.notes || `JunQi Desktop ${options.version}`,
    pub_date: options.pubDate || new Date().toISOString(),
    platforms,
  };
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  await generateUpdaterManifest({
    assetsDir: args['assets-dir'],
    repo: args.repo,
    tag: args.tag,
    version: args.version,
    notes: args.notes,
    output: args.output,
  });
}
