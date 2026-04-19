import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

export default [
  {
    ignores: [
      "dist/**",
      "**/dist/**",
      "build/**",
      "**/build/**",
      "coverage/**",
      "**/coverage/**",
      "node_modules/**",
      "styles.css",
      "test/.obsidian/**",
    ],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  js.configs.recommended,
  ...tsPlugin.configs["flat/recommended"],
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: "latest",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-prototype-builtins": "off",
      "no-useless-assignment": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
];
