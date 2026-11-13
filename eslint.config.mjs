// @ts-check
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    "**/.next/",
    "**/.turbo/",
    "**/coverage/",
    "**/playwright-report/",
    "**/test-results/",
    "**/next-env.d.ts",
    "packages/db/migrations/",
  ]),

  // Every TypeScript file: strict, type-aware rules.
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // Plain JavaScript config files have no type information.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // Next.js web app: React, hooks and Next-specific rules.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [nextVitals, nextTypeScript],
    settings: { next: { rootDir: "apps/web/" } },
  },

  // Shared design system: React hooks rules (the web app gets them from Next's config).
  {
    files: ["packages/ui/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },

  // Accessibility is non-negotiable for every interface file. Next's preset
  // already registers the jsx-a11y plugin for the web app, so there we only
  // switch on the strict rule set; the design system registers it itself.
  {
    files: ["packages/ui/**/*.tsx"],
    extends: [jsxA11y.flatConfigs.strict],
  },
  {
    files: ["apps/web/**/*.tsx", "packages/ui/**/*.tsx"],
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      // Teach the rule which Brawzer components are form controls.
      "jsx-a11y/label-has-associated-control": [
        "error",
        { controlComponents: ["Checkbox", "Switch", "Input"], assert: "either", depth: 3 },
      ],
    },
  },

  // NestJS API and Node packages.
  {
    files: ["apps/{api,runtime-agent}/**/*.ts", "packages/{contracts,db,net-policy}/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      // Nest modules are decorated, intentionally empty classes.
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
    },
  },

  // Command-line scripts report through the console.
  {
    files: ["packages/db/src/migrate.ts"],
    rules: { "no-console": "off" },
  },

  // Tests may assert on known-present values.
  {
    files: ["**/*.test.{ts,tsx}", "**/e2e/**/*.ts", "**/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
]);
