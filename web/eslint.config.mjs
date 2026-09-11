import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Vendored third-party components, kept byte-close to upstream so they can be re-pulled.
    // The React Compiler hook rules fire on their mount-time capability detection, which is not
    // a defect here — and correcting it would fork the file, which is what stops anyone ever
    // pulling the fix when upstream ships one. Inline disables do not reach these rules.
    files: [
      "components/ui/glass-surface.tsx",
      "components/ui/mesh-portfolio.tsx",
      "components/ui/border-glow.tsx",
      "components/ui/gradient-waves.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/refs": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
