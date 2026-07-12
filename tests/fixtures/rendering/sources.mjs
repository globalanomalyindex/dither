function createFixture(id, width, height, createValue) {
  const pixels = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = createValue(x, y);
    }
  }

  return Object.freeze({ id, width, height, pixels });
}

export function createGradient16() {
  return createFixture("gradient-16", 16, 16, (x, y) =>
    Math.round(((x / 15) * 0.65 + (y / 15) * 0.35) * 255),
  );
}

export function createCheckerEdge16() {
  return createFixture("checker-edge-16", 16, 16, (x, y) => {
    let value = x < 8 ? 32 : 224;

    if (y >= 8) {
      value = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? 48 : 208;
    }

    if (x === y || x === 15 - y) {
      value = 128;
    }

    return value;
  });
}

export function createDetailField24() {
  return createFixture("detail-field-24", 24, 24, (x, y) => {
    const wave = (x * 37 + y * 53 + x * y * 11) % 97;
    const blocks = ((Math.floor(x / 4) + Math.floor(y / 3)) % 3) * 52;
    const center = Math.abs(x - 12) + Math.abs(y - 12) <= 6 ? 60 : 0;
    return (wave + blocks + center) % 256;
  });
}

export const SOURCE_FIXTURES = Object.freeze({
  "gradient-16": createGradient16,
  "checker-edge-16": createCheckerEdge16,
  "detail-field-24": createDetailField24,
});
