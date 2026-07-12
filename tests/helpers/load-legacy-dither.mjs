import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";


const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultSourcePath = resolve(repositoryRoot, "dither.js");
const TEST_EXPORT = "\nglobalThis.__DITHER_TEST_REGISTRY__ = DitherAlgorithms;\n";


export async function loadLegacyDitherRegistry(options = {}) {
  const sourcePath = options.sourcePath
    ? resolve(options.sourcePath)
    : defaultSourcePath;
  const source = await readFile(sourcePath, "utf-8");
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const context = vm.createContext({ console, structuredClone });
  const script = new vm.Script(`${source}${TEST_EXPORT}`, {
    filename: sourcePath,
  });

  script.runInContext(context, {
    timeout: options.timeoutMs ?? 10_000,
  });

  const exposedAlgorithms = context.__DITHER_TEST_REGISTRY__;
  if (!Array.isArray(exposedAlgorithms)) {
    throw new TypeError("dither.js did not expose an algorithm array");
  }

  const algorithms = Object.freeze(Array.from(exposedAlgorithms));

  return Object.freeze({
    algorithms,
    findAlgorithm(id) {
      return algorithms.find((algorithm) => algorithm.id === id);
    },
    sourceSha256,
  });
}
