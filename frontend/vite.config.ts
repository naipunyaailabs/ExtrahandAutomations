import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  // `npm run dev` only: the Vite dev server forwards /api to the backend
  const apiTarget = env.DEV_BACKEND_URL || env.VITE_API_BASE_URL || "http://127.0.0.1:5074";

  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_DEV_PORT) || 3074,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          xfwd: true,
          cookieDomainRewrite: "",
          cookiePathRewrite: "/",
        },
      },
    },
  };
});
