import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import { createAppRouter } from "./router";
import { createAppQueryClient } from "./api/queryClient";
import "./styles/tokens.css";
import "./styles/base.css";

/**
 * 应用入口（08 §1）：Vue + Router + QueryClient；生产同源由 Fastify 托管，
 * 开发模式 Vite 只代理 /api。
 */
const app = createApp(App);
app.use(createAppRouter());
app.use(VueQueryPlugin, { queryClient: createAppQueryClient() });
app.mount("#app");
