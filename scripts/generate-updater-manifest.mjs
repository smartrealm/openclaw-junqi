import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : [path];
  }));
  return nested.flat();
}

function releaseUrl(repo, tag, filename) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}

export async function generateUpdaterManifest(options) {
  const paths = await filesRecursively(options.assetsDir);
  const artifacts = paths.filter((path) => !path.endsWith('.sig'));
  const find = (pattern, label) => {
    const matches = artifacts.filter((path) => pattern.test(basename(path)));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one ${label}, found ${matches.length}`);
    }
    return matches[0];
  };
  const signedEntry = async (path) => {
    const signature = (await readFile(`${path}.sig`, 'utf8')).trim();
    if (!signature) throw new Error(`Empty updater signature for ${path}`);
    const filename = basename(path);
    return {
      signature,
      url: releaseUrl(options.repo, options.tag, filename),
    };
  };

  const windowsX64Nsis = await signedEntry(find(/_x64-setup\.exe$/i, 'Windows x64 NSIS installer'));
  const windowsX64Msi = await signedEntry(find(/_x64(?:_[^/]*)?\.msi$/i, 'Windows x64 MSI installer'));
  const windowsArmNsis = await signedEntry(find(/_arm64-setup\.exe$/i, 'Windows ARM64 NSIS installer'));
  const windowsArmMsi = await signedEntry(find(/_arm64(?:_[^/]*)?\.msi$/i, 'Windows ARM64 MSI installer'));
  const macUniversal = await signedEntry(find(/_universal\.app\.tar\.gz$/i, 'macOS universal updater'));

  const manifest = {
    version: options.version,
    notes: options.notes || `JunQi Desktop ${options.version}`,
    pub_date: options.pubDate || new Date().toISOString(),
    platforms: {
      'windows-x86_64': windowsX64Nsis,
      'windows-x86_64-nsis': windowsX64Nsis,
      'windows-x86_64-msi': windowsX64Msi,
      'windows-aarch64': windowsArmNsis,
      'windows-aarch64-nsis': windowsArmNsis,
      'windows-aarch64-msi': windowsArmMsi,
      'darwin-aarch64': macUniversal,
      'darwin-x86_64': macUniversal,
      'darwin-universal': macUniversal,
      'darwin-aarch64-app': macUniversal,
      'darwin-x86_64-app': macUniversal,
      'darwin-universal-app': macUniversal,
    },
  };
  await writeFile(options.output, `${JSON.stringify(manifest, null, 2)}\n`);
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
