import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: appRoot,
  publicDir: `${projectRoot}/public`,
  plugins: [react()],
  server: {
    watch: {
      ignored: [
        "**/data/**",
        "**/ios/**",
        "**/public/**/pages/**",
        "**/public/**/crops/**",
      ],
    },
  },
  build: {
    outDir: `${projectRoot}/dist-pipeline-compare`,
    emptyOutDir: true,
  },
});
