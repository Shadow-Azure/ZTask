import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

// workspace 统一测试配置：Vue SFC 转换进 vitest 管线；环境由各 spec 头注释指定
// （tests/web-shell 用 jsdom，其余 node）。目录过滤由 CLI 参数（apps tests）传入。
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "node",
  },
});
