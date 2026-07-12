export default [
  {
    ignores: [
      "app.js",
      "dither.js",
      "dist/**",
      "engine.js",
      "grain.js",
      "index.html",
      "node_modules/**",
      "paintstroke.js",
      "playwright-report/**",
      "style.css",
      "test-results/**",
    ],
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.{js,mjs}", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
      },
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "no-undef": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-var": "error",
      "object-shorthand": "error",
      "prefer-const": "error",
    },
  },
];
