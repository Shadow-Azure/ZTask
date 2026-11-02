/**
 * 进程内按 key 串行的写队列（04 §5.1）：任务按 taskId 入队，成员/全局操作按各自 key 入队。
 * 同 key 严格串行、失败不阻塞后续；不同 key 并行。它是乐观版本复查的执行边界。
 */

export interface WriteQueue {
  /** 在 key 的队列尾追加任务并等待其完成；同 key 前序失败不阻塞本任务。 */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** 等待全部在途任务结束（含失败的）；优雅关闭前调用（04 §9 关闭顺序）。 */
  drain(): Promise<void>;
  /** 当前在途任务数（观测用）。 */
  pendingCount(): number;
}

/**
 * 创建空队列。单写者保证（数据目录锁）之下，它提供进程内的第二层串行：
 * 同 key 严格按提交顺序执行且互不重叠，单任务失败只把错误交回调用者、不阻塞同 key 后续任务。
 * @returns WriteQueue 实例。
 */
export function createWriteQueue(): WriteQueue {
  const chains = new Map<string, Promise<unknown>>();
  const inflight = new Set<Promise<unknown>>();
  let pending = 0;

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const prev = chains.get(key) ?? Promise.resolve();
      // 前序无论成败都继续执行本任务：单个 mutation 失败不能卡死该聚合的后续写入。
      const next = prev.then(task, task);
      chains.set(key, next.catch(() => undefined));
      pending += 1;
      // drain 只需要"等它结束"，不需要复刻 rejection；否则每次业务失败都会变成 unhandled rejection。
      const tracked = next.then(
        () => undefined,
        () => undefined,
      );
      const settled = tracked.finally(() => {
        pending -= 1;
        inflight.delete(settled);
      });
      inflight.add(settled);
      return next;
    },
    async drain(): Promise<void> {
      await Promise.allSettled([...inflight]);
    },
    pendingCount(): number {
      return pending;
    },
  };
}
