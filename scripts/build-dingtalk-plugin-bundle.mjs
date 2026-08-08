#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNpmCommand } from "./npm-command.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
export const pluginRoot = path.join(repositoryRoot, "packages", "junqi-dingtalk");
export const resourceDirectory = path.join(repositoryRoot, "src-tauri", "resources", "dingtalk");
export const generatedDirectory = path.join(repositoryRoot, "src", "generated");
export const bundledArchivePath = path.join(resourceDirectory, "junqi-dingtalk.tgz");
export const resourceMetadataPath = path.join(resourceDirectory, "metadata.json");
export const generatedMetadataPath = path.join(
  generatedDirectory,
  "dingtalkPluginBundle.generated.json",
);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeIfChanged(filePath, bytes) {
  let current = null;
  try {
    current = await readFile(filePath);
  } catch {
    current = null;
  }
  const next = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (current?.equals(next)) return;
  await writeFile(filePath, next);
}

async function findArchive(distDirectory) {
  const archives = (await readdir(distDirectory)).filter((entry) => entry.endsWith(".tgz"));
  if (archives.length !== 1) {
    throw new Error(`Expected one DingTalk plugin archive, found ${archives.length}`);
  }
  return path.join(distDirectory, archives[0]);
}

export async function buildDingTalkPluginBundle() {
  runNpmCommand(["run", "pack:plugin"], { cwd: pluginRoot, stdio: "inherit" });
  const packageJson = JSON.parse(await readFile(path.join(pluginRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(pluginRoot, "openclaw.plugin.json"), "utf8"));
  if (packageJson.name !== "@junqi/openclaw-dingtalk-business" || manifest.id !== "junqi-dingtalk") {
    throw new Error("Unexpected DingTalk plugin package identity");
  }
  const sourceArchive = await findArchive(path.join(pluginRoot, "dist"));
  const archiveBytes = await readFile(sourceArchive);
  const metadata = {
    formatVersion: 1,
    pluginId: manifest.id,
    packageName: packageJson.name,
    pluginVersion: packageJson.version,
    toolCount: manifest.contracts.tools.length,
    sha256: createHash("sha256").update(archiveBytes).digest("hex"),
    archiveFile: "junqi-dingtalk.tgz",
    resourcePath: "dingtalk/junqi-dingtalk.tgz",
  };
  const metadataJson = stableJson(metadata);
  await mkdir(resourceDirectory, { recursive: true });
  await mkdir(generatedDirectory, { recursive: true });
  await Promise.all([
    writeIfChanged(bundledArchivePath, archiveBytes),
    writeIfChanged(resourceMetadataPath, metadataJson),
    writeIfChanged(generatedMetadataPath, metadataJson),
  ]);
  console.log(`Bundled ${metadata.packageName}@${metadata.pluginVersion} with ${metadata.toolCount} tools`);
  return metadata;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await buildDingTalkPluginBundle();
}
