/// <reference types="vitest" />
import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig(({ mode }) => ({
  build: {
    target: "es2020",
    outDir: "dist",
    lib: {
      entry: [
        resolve(__dirname, "src/index.ts"),
        resolve(__dirname, "src/fork/fork.ts")
      ],
    },
    rollupOptions: {
      external: [
        "http",
        "https",
        "child_process",
        "open",
        "ws",
        "iconv-lite",
        "zlib",
        "fs",
        "stack-trace"
      ],
      output: {
        globals: {
          http: "http",
          https: "https",
          child_process: "cp",
          open: "open",
          "ws": "ws",
          "iconv-lite": "iconv",
          "zlib": "zlib",
          "fs": "fs",
          "stack-trace": "stackTrace"
        },
      },
    },
  },
  plugins: [dts()],
}));
