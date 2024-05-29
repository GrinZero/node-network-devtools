/// <reference types="vitest" />
import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig(({ mode }) => ({
  build: {
    target: "es2020",
    outDir: "dist",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "network-debugger",
    },
    rollupOptions: {
      external: [
        "http",
        "https",
        "chrome-remote-interface",
        "child_process",
        "open",
        "ws",
        "iconv-lite",
        "chardet"
      ],
      output: {
        globals: {
          http: "http",
          https: "https",
          "chrome-remote-interface": "CRT",
          child_process: "cp",
          open: "open",
          "ws": "ws",
          "iconv-lite": "iconv",
          "chardet": "chardet"
        },
      },
    },
  },
  plugins: [dts()],
}));
