import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  // A second Vite process must not replace the running app's optimized modules.
  cacheDir: `.cache/vite/${mode}`,
  plugins: [
    {
      name: "development-csp",
      apply: "serve",
      transformIndexHtml: (html) =>
        html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"),
    },
  ],
  base: "./",
  optimizeDeps: {
    include: [
      "lit",
      "lit/directives/repeat.js",
      "lit/directives/live.js",
      "dexie",
      "fuse.js",
      "jsfxr",
    ],
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8080" },
    port: 5173,
    strictPort: true,
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/googleaccountid.txt"],
    },
  },
  build: { target: "es2022" },
}));
