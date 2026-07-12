import { stat } from "node:fs/promises";
import { resolve } from "node:path";

export const STATIC_RUNTIME_FILES = Object.freeze([
  "index.html",
  "style.css",
  "dither.js",
  "engine.js",
  "grain.js",
  "paintstroke.js",
  "app.js",
  "fonts",
]);

export function createStaticRuntimeCopyPlan(repositoryRoot, outputRoot) {
  return STATIC_RUNTIME_FILES.map((relativePath) => ({
    relativePath,
    sourcePath: resolve(repositoryRoot, relativePath),
    destinationPath: resolve(outputRoot, relativePath),
  }));
}

export async function validateStaticRuntimeManifest(repositoryRoot) {
  const resolvedEntries = STATIC_RUNTIME_FILES.map((entry) =>
    resolve(repositoryRoot, entry),
  );

  await Promise.all(
    resolvedEntries.map(async (entry) => {
      const entryStat = await stat(entry);
      if (!entryStat.isFile() && !entryStat.isDirectory()) {
        throw new Error(`Unsupported runtime entry: ${entry}`);
      }
    }),
  );

  return resolvedEntries;
}
