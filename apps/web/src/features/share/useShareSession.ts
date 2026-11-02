import { ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { ApiError, type MemberSummary } from "@ztask/shared";
import { shareApi } from "../../api/share";

/**
 * 成员会话的模块级状态（03 §4 分享会话、08 §6.1/§7）：
 * 前端只保留脱敏的成员摘要；token/verifier 绝不进入这里。
 * "是否已确认会话"由成员壳的本地 ready 门控（ShareLayout），不在模块态里重复记一份。
 */
const member = ref<MemberSummary | null>(null);

/**
 * 判断是否为成员域 401（会话缺失/过期/链接失效）。
 * @param cause 查询或动作抛出的错误。
 * @returns 命中成员域 401 时为 true。
 */
export function isShareUnauthorized(cause: unknown): boolean {
  return cause instanceof ApiError && cause.statusCode === 401;
}

/**
 * 成员会话 composable：恢复、写入、注销与统一的 401 兜底。
 * 401 一律清理 share 作用域缓存并进入失效页，防止后退展示旧私有内容（08 §7）。
 * @returns 会话状态与动作。
 */
export function useShareSession() {
  const router = useRouter();
  const queryClient = useQueryClient();

  function clearShareCache(): void {
    queryClient.removeQueries({ queryKey: ["share"] });
  }

  /**
   * 清理内存会话并跳转失效页（不把后端错误正文或 token 写入日志）。
   * @param reason 失效来源；`logout` 表示用户主动退出，页面文案据此区分（避免把退出说成被吊销）。
   */
  async function invalidate(reason?: "logout"): Promise<void> {
    member.value = null;
    clearShareCache();
    const target = reason === "logout" ? "/share-invalid?from=logout" : "/share-invalid";
    if (router.currentRoute.value.fullPath !== target) {
      await router.replace(target);
    }
  }

  /**
   * 数据查询的 401 兜底：命中则清理会话并进入失效页。
   * @param cause 查询/mutation 抛出的错误。
   * @returns 是否已按 401 处理。
   */
  function handleAuthError(cause: unknown): boolean {
    if (!isShareUnauthorized(cause)) return false;
    void invalidate();
    return true;
  }

  /**
   * Cookie 恢复会话；401 清理缓存进入失效页，其他失败向上抛给成员壳决定重试（§6.8）。
   * @returns 是否恢复成功（401 表示无有效会话）。
   */
  async function restore(): Promise<boolean> {
    try {
      const response = await shareApi.restore();
      member.value = response.member;
      return true;
    } catch (cause) {
      if (isShareUnauthorized(cause)) {
        await invalidate();
        return false;
      }
      throw cause;
    }
  }

  /** 交换成功后写入成员摘要（token 不进状态）。 */
  function setMember(next: MemberSummary): void {
    member.value = next;
  }

  /**
   * 注销：删除服务端会话、清理 share 缓存并进入失效页（08 §7）。
   * DELETE 幂等；即使请求失败也先清本地缓存，避免后退看到旧数据。
   */
  async function logout(): Promise<void> {
    try {
      await shareApi.logout();
    } finally {
      await invalidate("logout");
    }
  }

  return { member, restore, setMember, logout, handleAuthError, clearShareCache };
}
