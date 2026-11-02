import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// 开发模式只代理 /api 到本机 loopback 服务；不产生第二套业务服务（01 §2）。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8123",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
