import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const tsFiles = ["**/*.ts", "**/*.tsx"];
const tsEslintRecommended =
  tsPlugin.configs["eslint-recommended"]?.overrides?.[0]?.rules ?? {};

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
  {
    files: tsFiles,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsEslintRecommended,
      ...tsPlugin.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-prototype-builtins": "off",
      "no-useless-assignment": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
];
