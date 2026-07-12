import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createStaticRuntimeCopyPlan,
  validateStaticRuntimeManifest,
} from "./static-runtime-manifest.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(repositoryRoot, "dist");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function createIntegrityEntry(absolutePath) {
  const contents = await readFile(absolutePath);
  const fileStat = await stat(absolutePath);
  const repositoryRelativePath = relative(outputRoot, absolutePath)
    .split(sep)
    .join("/");

  return {
    bytes: fileStat.size,
    path: repositoryRelativePath,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

async function build() {
  await validateStaticRuntimeManifest(repositoryRoot);
  await rm(outputRoot, { force: true, recursive: true });
  await mkdir(outputRoot, { recursive: true });

  const copyPlan = createStaticRuntimeCopyPlan(repositoryRoot, outputRoot);
  for (const entry of copyPlan) {
    await cp(entry.sourcePath, entry.destinationPath, {
      force: true,
      recursive: true,
    });
  }

  const outputFiles = (await listFiles(outputRoot)).sort();
  const integrity = await Promise.all(outputFiles.map(createIntegrityEntry));
  const buildManifest = {
    files: integrity,
    schemaVersion: 1,
  };

  await writeFile(
    resolve(outputRoot, "build-manifest.json"),
    `${JSON.stringify(buildManifest, null, 2)}\n`,
    "utf-8",
  );

  console.log(`Built ${integrity.length} runtime files in ${outputRoot}`);
}

await build();
