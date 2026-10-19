import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/workbench/testSetup.ts"],
    include: ["src/workbench/**/*.test.{ts,tsx}"],
    clearMocks: true,
  },
});
