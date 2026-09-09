import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const contracts = fileURLToPath(new URL("./contracts", import.meta.url));
const modules = fileURLToPath(new URL("./node_modules", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@clearmind\/contracts\/(.*)$/, replacement: `${contracts}/$1` },
      { find: /^@bufbuild\/protobuf$/, replacement: `${modules}/@bufbuild/protobuf` },
      { find: /^@connectrpc\/connect$/, replacement: `${modules}/@connectrpc/connect` },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/clearmind.v1.": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.tsx", "tests/**/*.test.ts"],
  },
});
