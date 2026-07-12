import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.{js,ts}",
      "tests/rendering/**/*.test.{js,ts,mjs}",
    ],
    passWithNoTests: false,
    reporters: ["default"],
  },
});
