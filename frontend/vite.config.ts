import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true, rewrite: path => path.replace(/^\/api/, "") } } },
  build: {
    rollupOptions: {
      output: { manualChunks: { charts: ["recharts"], ui: ["@radix-ui/react-dialog", "lucide-react"], markdown: ["react-markdown", "remark-gfm"] } },
    },
  },
});
