import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: { parserOptions: { projectService: true } },
    plugins: { sonarjs },
    rules: {
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-ignore": true, "ts-nocheck": true, "ts-check": false, "ts-expect-error": true,
      }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "sonarjs/cognitive-complexity": ["error", 20],
    },
  },
);
