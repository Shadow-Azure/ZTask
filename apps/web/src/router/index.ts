import { createRouter, createWebHashHistory, type Router } from "vue-router";
import AdminLayout from "../layouts/AdminLayout.vue";
import ShareLayout from "../layouts/ShareLayout.vue";
import TrackerPage from "../pages/TrackerPage.vue";
import MembersPage from "../pages/MembersPage.vue";
import ShareSessionPage from "../pages/ShareSessionPage.vue";
import MemberHomePage from "../pages/MemberHomePage.vue";
import ShareInvalidPage from "../pages/ShareInvalidPage.vue";

/**
 * 应用路由（03 §2 路由与页面边界）：hash 模式；
 * 管理页深链状态在 query（folder/tab/members/task）。
 * 导航 guard 只负责体验，真正权限由 API 决定——成员壳不渲染管理导航，
 * 但不得依赖前端隐藏来保证安全。
 * @returns 配置好的 Router 实例（hash 模式）。
 */
export function createAppRouter(): Router {
  return createRouter({
    history: createWebHashHistory(),
    routes: [
      {
        path: "/",
        component: AdminLayout,
        children: [
          { path: "", redirect: "/tracker" },
          { path: "tracker", name: "tracker", component: TrackerPage },
          { path: "members", name: "members", component: MembersPage },
        ],
      },
      { path: "/s/:token", name: "share-session", component: ShareSessionPage },
      {
        path: "/s",
        component: ShareLayout,
        children: [
          { path: "", redirect: "/s/home" },
          { path: "home", name: "share-home", component: MemberHomePage },
          { path: "tracker", name: "share-tracker", component: TrackerPage, props: { access: "readonly" } },
        ],
      },
      { path: "/share-invalid", name: "share-invalid", component: ShareInvalidPage },
      { path: "/:pathMatch(.*)*", redirect: "/tracker" },
    ],
  });
}
