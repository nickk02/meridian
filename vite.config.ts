import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The SPA lives in web/ and builds to ./dist at the repo root, which is what
// wrangler.jsonc points assets.directory at. The Worker (worker/) is bundled
// separately by wrangler and is not part of this Vite build.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
