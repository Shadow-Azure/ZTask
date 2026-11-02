<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { FolderTreeNode, Task } from "@ztask/shared";
import { shareApi } from "../api/share";
import { isShareUnauthorized, useShareSession } from "../features/share/useShareSession";
import MemberTaskCard from "../features/share/MemberTaskCard.vue";
import LoadingState from "../components/ui/LoadingState.vue";
import ErrorState from "../components/ui/ErrorState.vue";

/**
 * 成员个人页（08 §6.2，原型 1892–1910）：身份区 + 「我负责的 / 我协作的」两组只读任务卡。
 * 本 issue 的成员个人页只有读取路径；owner 的进度/详情/小任务编辑在后续 issue 接入，
 * 因此页面不渲染任何 input/button，也不暗示存在编辑入口（03 §5）。
 */
const { member, handleAuthError } = useShareSession();

const homeQuery = useQuery({
  queryKey: ["share", "tasks", "home"],
  queryFn: async () => {
    try {
      return await shareApi.home();
    } catch (cause) {
      // 401 统一清理 share 缓存并进入失效页，不停留在错误态（08 §7）。
      handleAuthError(cause);
      throw cause;
    }
  },
  refetchInterval: 15_000,
});

/** 成员可见任务夹树只用于卡片上的任务夹路径，请求失败不影响个人页主体。 */
const foldersQuery = useQuery({
  queryKey: ["share", "folders", "tree"],
  queryFn: async () => {
    try {
      return await shareApi.foldersTree();
    } catch (cause) {
      handleAuthError(cause);
      throw cause;
    }
  },
  refetchInterval: 15_000,
});

const owned = computed(() => homeQuery.data.value?.owned ?? []);
const collaborated = computed(() => homeQuery.data.value?.collaborated ?? []);

/** 会话恢复后才有成员摘要；独立挂载（测试）时回退为「成员」避免崩溃。 */
const displayName = computed(() => member.value?.name ?? "成员");
const initial = computed(() => displayName.value.slice(0, 1));
const memberColor = computed(() => member.value?.color ?? "var(--blue)");

/** 401 已交由 handleAuthError 处理，此时页面正在跳转，不展示可重试的错误态。 */
const unauthorized = computed(() => homeQuery.isError.value && isShareUnauthorized(homeQuery.error.value));

/** folderId → 「迭代 / 子夹」路径，仅含成员可见任务夹及祖先（05 §6.11）。 */
const folderPathById = computed(() => {
  const map = new Map<string, string>();
  const walk = (nodes: FolderTreeNode[], trail: string[]): void => {
    for (const node of nodes) {
      const path = [...trail, node.name];
      map.set(node.id, path.join(" / "));
      walk(node.children ?? [], path);
    }
  };
  walk(foldersQuery.data.value?.tree ?? [], []);
  return map;
});

/**
 * 任务夹路径：树未加载或任务夹不在可见范围时返回 undefined（卡上不渲染 chip）。
 * @param task 主任务。
 * @returns 路径字符串或 undefined。
 */
function folderPathOf(task: Task): string | undefined {
  return folderPathById.value.get(task.folderId);
}
</script>

<template>
  <div class="share-page">
    <div class="share-id">
      <span class="ava" :style="{ background: memberColor }" aria-hidden="true">{{ initial }}</span>
      <div>
        <div class="hello">你好，{{ displayName }}</div>
        <div class="scope">
          此链接仅展示与你相关的事项（你负责的 {{ owned.length }} 项 · 你协作的 {{ collaborated.length }} 项），其他成员的任务不可见。
        </div>
      </div>
    </div>

    <div class="share-body">
      <div class="share-body-inner">
        <LoadingState v-if="homeQuery.isLoading.value" label="任务加载中…" />
        <div v-else-if="unauthorized" class="session-expired">
          <LoadingState label="会话已失效，正在跳转…" />
        </div>
        <ErrorState
          v-else-if="homeQuery.isError.value"
          message="任务加载失败"
          retryable
          @retry="homeQuery.refetch()"
        />
        <template v-else>
          <section class="share-group" aria-labelledby="share-owned-title">
            <h3 id="share-owned-title">我负责的任务 <span class="cnt">{{ owned.length }}</span></h3>
            <p class="gdesc">你负责的事项在此汇总展示，进度与进展详情为只读。</p>
            <MemberTaskCard
              v-for="task in owned"
              :key="task.id"
              :task="task"
              :folder-path="folderPathOf(task)"
            />
            <div v-if="owned.length === 0" class="empty-tip">暂无你负责的任务</div>
          </section>

          <section class="share-group" aria-labelledby="share-collab-title">
            <h3 id="share-collab-title">我协作的任务 <span class="cnt">{{ collaborated.length }}</span></h3>
            <p class="gdesc">协作任务由负责人维护进度，此处只读。</p>
            <MemberTaskCard
              v-for="task in collaborated"
              :key="task.id"
              :task="task"
              readonly
              :folder-path="folderPathOf(task)"
            />
            <div v-if="collaborated.length === 0" class="empty-tip">暂无你协作的任务</div>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.share-page {
  height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
}

/* 原型 383–385：身份区使用蓝色渐隐底。 */
.share-id {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 22px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--blue) 9%, transparent), transparent);
  border-bottom: 1px solid var(--border);
}

.ava {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  flex: none;
}

.hello {
  font-size: 14.5px;
  font-weight: 700;
}

.scope {
  font-size: 11.5px;
  color: var(--text-dim);
}

.share-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px 44px;
}

.share-body-inner {
  max-width: 980px;
  margin: 0 auto;
}

.share-group {
  margin-bottom: 22px;
}

.share-group > h3 {
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cnt {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
  font-weight: 400;
}

.gdesc {
  font-size: 11.5px;
  color: var(--text-faint);
  margin: 4px 0 10px;
}

.empty-tip {
  padding: 18px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-faint);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-panel);
}

.session-expired {
  padding-top: 12px;
}

@media (max-width: 720px) {
  .share-id {
    padding: 12px 14px;
  }

  .share-body {
    padding: 14px 14px 32px;
  }
}
</style>
