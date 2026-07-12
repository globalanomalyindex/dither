import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const EXPECTED_DEV_DEPENDENCIES = {
  "@axe-core/playwright": "4.11.3",
  "@playwright/test": "1.61.1",
  eslint: "10.7.0",
  prettier: "3.9.4",
  typescript: "6.0.3",
  vite: "8.1.4",
  vitest: "4.1.10",
};

const REQUIRED_SCRIPTS = [
  "build",
  "dev",
  "format",
  "format:check",
  "lint",
  "preview",
  "test",
  "test:e2e",
  "test:unit",
  "typecheck",
  "verify",
];

const REQUIRED_CONFIG_FILES = [
  ".prettierrc.json",
  "eslint.config.mjs",
  "playwright.config.mjs",
  "tsconfig.json",
  "vite.config.mjs",
];

test("the development toolchain is pinned and reproducible", () => {
  assert.equal(existsSync("package.json"), true, "package.json must exist");
  assert.equal(
    existsSync("package-lock.json"),
    true,
    "package-lock.json must be committed",
  );

  const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf-8"));

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.devDependencies, EXPECTED_DEV_DEPENDENCIES);
  assert.equal(packageLock.lockfileVersion, 3);
  assert.equal(packageLock.packages[""].name, packageJson.name);
  assert.deepEqual(packageLock.packages[""].devDependencies, EXPECTED_DEV_DEPENDENCIES);
});

test("the toolchain exposes every verification command", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));

  for (const script of REQUIRED_SCRIPTS) {
    assert.equal(
      typeof packageJson.scripts?.[script],
      "string",
      `missing npm script: ${script}`,
    );
  }
});

test("the toolchain configuration is explicit and repository-owned", () => {
  for (const file of REQUIRED_CONFIG_FILES) {
    assert.equal(existsSync(file), true, `missing configuration file: ${file}`);
  }
});
