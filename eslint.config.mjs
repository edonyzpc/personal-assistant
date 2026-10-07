import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";

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
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.{spec,test}.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { obsidianmd },
    rules: {
      "@typescript-eslint/unbound-method": "error",
      "obsidianmd/prefer-create-el": "error",
    },
  },
];
