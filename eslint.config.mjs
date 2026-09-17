import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  { ignores: [".next/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["tests/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default eslintConfig;
