import { createHash } from "node:crypto";

function cloneValue(value) {
  return structuredClone(value);
}

export function resolveAlgorithmParameters(algorithm, overrides = {}) {
  const parameters = Array.isArray(algorithm.params) ? algorithm.params : [];
  const declaredIds = new Set(parameters.map((parameter) => parameter.id));

  for (const overrideId of Object.keys(overrides)) {
    if (!declaredIds.has(overrideId)) {
      throw new Error(
        `Unknown parameter "${overrideId}" for algorithm "${algorithm.id}"`,
      );
    }
  }

  if (declaredIds.has("seed") && !Object.hasOwn(overrides, "seed")) {
    throw new Error(
      `Fixture algorithm "${algorithm.id}" requires an explicit seed override`,
    );
  }

  return Object.fromEntries(
    parameters.map((parameter) => [
      parameter.id,
      cloneValue(
        Object.hasOwn(overrides, parameter.id)
          ? overrides[parameter.id]
          : parameter.default,
      ),
    ]),
  );
}

export function summarizeByteOutput(output, width, height) {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`Invalid output width: ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`Invalid output height: ${height}`);
  }
  if (!ArrayBuffer.isView(output) || output.BYTES_PER_ELEMENT !== 1) {
    throw new TypeError("Fixture output must be a one-byte typed array");
  }

  const expectedLength = width * height;
  if (output.length !== expectedLength) {
    throw new Error(
      `Output length ${output.length} does not match ${width} × ${height} (${expectedLength})`,
    );
  }

  const bytes = new Uint8Array(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  let min = 255;
  let max = 0;
  let sum = 0;
  let weightedChecksum = 0;
  const uniqueValues = new Set();

  for (let index = 0; index < output.length; index += 1) {
    const value = output[index];
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    weightedChecksum += value * (index + 1);
    uniqueValues.add(value);
  }

  return {
    constructor: output.constructor.name,
    length: output.length,
    min,
    max,
    uniqueCount: uniqueValues.size,
    sum,
    weightedChecksum,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function createRenderFixtureRecord({
  algorithmId,
  source,
  parameters,
  output,
}) {
  return {
    algorithmId,
    source: {
      id: source.id,
      width: source.width,
      height: source.height,
    },
    parameters: cloneValue(parameters),
    output: summarizeByteOutput(output, source.width, source.height),
  };
}
