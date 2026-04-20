import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/ruks-release-assets": {
        target: "https://github.com",
        changeOrigin: true,
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/api\/ruks-release-assets/, ""),
      },
      "/api/ruks-release-blobs": {
        target: "https://release-assets.githubusercontent.com",
        changeOrigin: true,
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/api\/ruks-release-blobs/, ""),
      },
    },
  },
});
