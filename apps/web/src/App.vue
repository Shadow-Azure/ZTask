<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { API_PREFIX } from "@ztask/shared";
import type { HealthPayload } from "@ztask/shared";

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; payload: HealthPayload }
  | { kind: "error"; message: string };

const health = ref<HealthState>({ kind: "loading" });
let pollTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshHealth(): Promise<void> {
  try {
    const response = await fetch(`${API_PREFIX}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health.value = { kind: "ok", payload: (await response.json()) as HealthPayload };
  } catch (cause) {
    health.value = { kind: "error", message: cause instanceof Error ? cause.message : String(cause) };
  }
}

onMounted(() => {
  void refreshHealth();
  pollTimer = setInterval(() => void refreshHealth(), 15_000);
});

onBeforeUnmount(() => {
  if (pollTimer !== undefined) clearInterval(pollTimer);
});
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <span class="brand">Z<em>Task</em></span>
      <span class="tag">管理端</span>
      <span class="spacer" />
      <span class="hint">本机管理 · 仅 loopback</span>
    </header>

    <main class="content">
      <section class="card placeholder">
        <h2>管理端壳</h2>
        <p>事项跟踪、成员管理与看板将在后续里程碑按原型逐屏接入。</p>
      </section>

      <section class="card health" data-testid="health-card">
        <h2>服务健康</h2>
        <p v-if="health.kind === 'loading'" class="dim">检查中…</p>
        <template v-else-if="health.kind === 'ok'">
          <p class="ok-line">
            <span class="dot ok" />服务正常
          </p>
          <dl>
            <div><dt>版本</dt><dd class="mono">{{ health.payload.version }}</dd></div>
            <div><dt>运行时长</dt><dd class="mono">{{ health.payload.uptimeSeconds }}s</dd></div>
          </dl>
        </template>
        <p v-else class="error-line">
          <span class="dot err" />服务不可达：{{ health.message }}
        </p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  height: 46px;
  background: #16181d;
  color: #cfd4dc;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
  flex: none;
}

.brand {
  font-weight: 700;
  font-size: 13.5px;
  color: #fff;
  letter-spacing: 0.2px;
}

.brand em {
  font-style: normal;
  color: #7ea4f4;
}

.tag {
  font-size: 10.5px;
  color: #8a919c;
  border: 1px solid #33383f;
  border-radius: 999px;
  padding: 1px 8px;
}

.hint {
  margin-left: auto;
  font-size: 11px;
  color: #69707b;
  font-family: var(--mono);
}

.content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
  padding: 14px;
  align-content: start;
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px 16px;
}

.card h2 {
  font-size: 13px;
  margin-bottom: 8px;
}

.placeholder p,
.dim {
  color: var(--text-dim);
}

dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}

dt {
  font-size: 11px;
  color: var(--text-faint);
}

dd {
  font-size: 12.5px;
  color: var(--text);
}

.mono {
  font-family: var(--mono);
}

.ok-line,
.error-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
}

.dot.ok {
  background: var(--green);
}

.dot.err {
  background: var(--red);
}

.error-line {
  color: var(--red);
  word-break: break-all;
}

@media (max-width: 900px) {
  .content {
    grid-template-columns: 1fr;
  }
}
</style>
