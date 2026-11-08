<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { FolderTreeNode, Task } from "@ztask/shared";
import { shareApi } from "../api/share";
import { isShareUnauthorized, useShareSession } from "../features/share/useShareSession";
import MemberTaskCard from "../features/share/MemberTaskCard.vue";
import { useToast } from "../components/ui/toast";
import LoadingState from "../components/ui/LoadingState.vue";
import ErrorState from "../components/ui/ErrorState.vue";

/**
 * 成员个人页（08 §6.2，原型 1892–1910）：身份区 + 「我负责的 / 我协作的 / 其他成员的任务」三组任务卡。
 * 「我负责的」开放受限编辑（进度、完整详情、一层小任务），另两组只读；
 * 编辑控件只在 owner 卡渲染，写权限最终由服务端 owner 校验决定（02 §4.2–4.3）。
 * 三组标题默认展开，点击标题可折叠/展开当前组。
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
const others = computed(() => homeQuery.data.value?.others ?? []);
const total = computed(() => owned.value.length + collaborated.value.length + others.value.length);

type GroupId = "owned" | "collab" | "others";
/** 三组默认展开；折叠只影响本次页面会话。 */
const collapsed = ref<Record<GroupId, boolean>>({ owned: false, collab: false, others: false });
function toggleGroup(id: GroupId): void {
  collapsed.value[id] = !collapsed.value[id];
}

/** 会话恢复后才有成员摘要；独立挂载（测试）时回退为「成员」避免崩溃。 */
const displayName = computed(() => member.value?.name ?? "成员");
const initial = computed(() => displayName.value.slice(0, 1));
const memberColor = computed(() => member.value?.color ?? "var(--blue)");

/** 401 已交由 handleAuthError 处理，此时页面正在跳转，不展示可重试的错误态。 */
const unauthorized = computed(() => homeQuery.isError.value && isShareUnauthorized(homeQuery.error.value));

const toast = useToast();
/** 「我负责的」任务卡实例：Ctrl+S 时逐卡提交全部草稿。 */
const cards = ref<Array<{ saveNow: (trigger: "auto" | "task" | "page") => Promise<boolean> } | null>>([]);

/**
 * Ctrl+S 保存整页：逐卡提交本任务的进度/详情草稿。
 * 至少一张卡有改动时提示「已保存整页修改」，否则提示没有需要保存的更改。
 */
async function savePage(): Promise<void> {
  const targets = cards.value.filter((card): card is NonNullable<typeof card> => card !== null);
  if (targets.length === 0) {
    toast.show("没有需要保存的更改");
    return;
  }
  const results = await Promise.all(targets.map((card) => card.saveNow("page")));
  toast.show(results.some(Boolean) ? "已保存整页修改" : "没有需要保存的更改");
}

/** 页面级 Ctrl/⌘+S：阻止浏览器保存网页，改存成员页所有任务草稿。 */
function onSaveShortcut(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  void savePage();
}

onMounted(() => document.addEventListener("keydown", onSaveShortcut));
onBeforeUnmount(() => document.removeEventListener("keydown", onSaveShortcut));

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
 * 任务夹路径：树未加载或任务夹不在树中时返回 undefined（卡上不渲染 chip）。
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
          此链接展示与管理员相同的团队全部事项（共 {{ total }} 项）：你负责的 {{ owned.length }} 项可更新，其余 {{ collaborated.length + others.length }} 项只读。
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
          <section class="share-group" :class="{ collapsed: collapsed.owned }" aria-labelledby="share-owned-title">
            <h3 id="share-owned-title">
              <button class="group-toggle" type="button" :aria-expanded="!collapsed.owned" aria-controls="share-owned-body" title="点击折叠或展开该组" @click="toggleGroup('owned')">
                <span class="chevron" aria-hidden="true">▾</span>我负责的任务 <span class="cnt">{{ owned.length }}</span>
              </button>
            </h3>
            <div v-show="!collapsed.owned" id="share-owned-body" class="group-body">
              <p class="gdesc">可以更新进度与完整进展详情（保存会追加快照）；改动停顿 2 秒自动保存，Ctrl+S 保存整页。</p>
              <MemberTaskCard
                v-for="task in owned"
                :key="task.id"
                ref="cards"
                :task="task"
                :folder-path="folderPathOf(task)"
                editable
              />
              <div v-if="owned.length === 0" class="empty-tip">暂无你负责的任务</div>
            </div>
          </section>

          <section class="share-group" :class="{ collapsed: collapsed.collab }" aria-labelledby="share-collab-title">
            <h3 id="share-collab-title">
              <button class="group-toggle" type="button" :aria-expanded="!collapsed.collab" aria-controls="share-collab-body" title="点击折叠或展开该组" @click="toggleGroup('collab')">
                <span class="chevron" aria-hidden="true">▾</span>我协作的任务 <span class="cnt">{{ collaborated.length }}</span>
              </button>
            </h3>
            <div v-show="!collapsed.collab" id="share-collab-body" class="group-body">
              <p class="gdesc">协作任务由负责人维护进度，此处只读。</p>
              <MemberTaskCard
                v-for="task in collaborated"
                :key="task.id"
                :task="task"
                readonly
                :folder-path="folderPathOf(task)"
              />
              <div v-if="collaborated.length === 0" class="empty-tip">暂无你协作的任务</div>
            </div>
          </section>

          <section class="share-group" :class="{ collapsed: collapsed.others }" aria-labelledby="share-others-title">
            <h3 id="share-others-title">
              <button class="group-toggle" type="button" :aria-expanded="!collapsed.others" aria-controls="share-others-body" title="点击折叠或展开该组" @click="toggleGroup('others')">
                <span class="chevron" aria-hidden="true">▾</span>其他成员的任务 <span class="cnt">{{ others.length }}</span>
              </button>
            </h3>
            <div v-show="!collapsed.others" id="share-others-body" class="group-body">
              <p class="gdesc">由其他成员负责的任务；你可以查看全部进展，但不能编辑。</p>
              <MemberTaskCard
                v-for="task in others"
                :key="task.id"
                :task="task"
                readonly
                readonly-label="其他成员 · 只读"
                :folder-path="folderPathOf(task)"
              />
              <div v-if="others.length === 0" class="empty-tip">暂无其他成员的任务</div>
            </div>
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

/* R8-D1（原型 1899）：原型 .share-body-inner 无任何宽度规则，内容列直接铺满 .share-body
 * 的内宽（1440 视口 x=22 / w=1396），故取消早期的 max-width:980px 居中收窄。 */

.share-group {
  margin-bottom: 22px;
}

.share-group > h3 {
  font-size: 13px;
  font-weight: 700;
}

.group-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  padding: 2px 6px;
  margin-left: -6px;
  border: 0;
  border-radius: 6px;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.group-toggle:hover {
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
}

.group-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--blue) 55%, transparent);
  outline-offset: 3px;
}

.group-toggle .chevron {
  display: inline-block;
  width: 14px;
  font-size: 12px;
  color: var(--text-dim);
  transition: transform 0.15s;
}

.share-group.collapsed .chevron {
  transform: rotate(-90deg);
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

/* 原型 1903/1908：空态是普通文本块（.empty-tip 在原型里没有额外 CSS，字体继承正文 13px/--text）。
 * R3-D1 去掉 12px 灰字弱化，仅保留内距。 */
.empty-tip {
  padding: 16px 4px;
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
