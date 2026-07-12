import { fileURLToPath, pathToFileURL } from "node:url";

import { loadLegacyDitherRegistry } from "../tests/helpers/load-legacy-dither.mjs";

function findDuplicates(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

export function createRegistryInventory({ sourceSha256, algorithms }) {
  const normalizedAlgorithms = algorithms.map((algorithm) => {
    const parameterIds = (algorithm.params ?? []).map((parameter) => parameter.id);

    return {
      id: algorithm.id,
      name: algorithm.name,
      category: algorithm.category,
      parameterIds,
      hasSeed: parameterIds.includes("seed"),
    };
  });

  const categoryCounts = Object.fromEntries(
    Array.from(
      normalizedAlgorithms.reduce((counts, algorithm) => {
        counts.set(algorithm.category, (counts.get(algorithm.category) ?? 0) + 1);
        return counts;
      }, new Map()),
    ).sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    sourceSha256,
    algorithmCount: normalizedAlgorithms.length,
    categoryCounts,
    duplicates: {
      algorithmIds: findDuplicates(
        normalizedAlgorithms.map((algorithm) => algorithm.id),
      ),
    },
    algorithms: normalizedAlgorithms,
  };
}

async function main() {
  const registry = await loadLegacyDitherRegistry();
  const inventory = createRegistryInventory(registry);
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href
  : null;

if (invokedPath === import.meta.url) {
  await main();
}
