import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import firebaseRulesPlugin from "@firebase/eslint-plugin-security-rules";

export default defineConfig([
  {
    ignores: [
      ".next/**/*",
      "dist/**/*",
      "node_modules/**/*",
      "public/**/*",
      "scripts/**/*",
      "DRAFT_firestore.rules",
      "firestore.rules.test.ts",
    ],
  },
  ...next,
  firebaseRulesPlugin.configs["flat/recommended"],
]);
