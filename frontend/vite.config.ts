import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const apiTarget = env.VITE_API_BASE_URL || "http://127.0.0.1:8050";

  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_DEV_PORT) || 5180,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
