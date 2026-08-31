import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  js.configs.recommended,

  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      "unicorn/recommended",
    ],
    plugins: { unicorn },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Type-aware linting only on TS files.
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },

  {
    files: ["**/*.{ts,tsx,mts}"],
    rules: {
      // Ban typecasting: no narrowing assertions, no `as` on fresh object/array
      // literals (type the declaration or use `satisfies`). `as const` allowed.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          objectLiteralTypeAssertions: "never",
          arrayLiteralTypeAssertions: "never",
        },
      ],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      // No truthiness checks on non-nullable non-booleans. Nullable values may
      // still be narrowed via `if (x)`.
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: true,
          allowNullableNumber: true,
        },
      ],
      "@typescript-eslint/no-inferrable-types": "error",
      "@typescript-eslint/array-type": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  globalIgnores(["node_modules/", "dist/"]),
]);

export default eslintConfig;
