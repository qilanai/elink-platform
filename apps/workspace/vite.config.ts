import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/apps/workspace/",
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    proxy: { "/api": { target: process.env.NEW_API_DEV_URL || "http://127.0.0.1:3000" } },
  },
});
