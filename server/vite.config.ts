import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      "~": resolve(import.meta.dirname, "./src"),
      // The API definition shared with `dot server serve`
      "@dot/server-api": resolve(
        import.meta.dirname,
        "../dot/src/server/api.ts",
      ),
    },
    // api.ts sits under dot/, which has its own copy of effect
    dedupe: ["effect"],
  },
  server: {
    port: Number(process.env.PORT ?? 7710),
    strictPort: true,
    proxy: {
      "/api": process.env.API_ORIGIN ?? "http://127.0.0.1:7700",
    },
  },
});
