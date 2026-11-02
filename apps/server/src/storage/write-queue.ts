/**
 * 进程内按 key 串行的写队列（04 §5.1）：任务按 taskId 入队，成员/全局操作按各自 key 入队。
 * 同 key 严格串行、失败不阻塞后续；不同 key 并行。它是乐观版本复查的执行边界。
 *
 * 队列另提供暂停闸门（06 §8/§10）：在线备份要求「暂停新 mutation → 等待在途写入 → 复制」
 * 的一致快照边界，因此 `pause()` 之后提交的任务必须排队到 `resume()` 之后才真正入链。
 */

export interface WriteQueue {
  /** 在 key 的队列尾追加任务并等待其完成；同 key 前序失败不阻塞本任务。 */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** 等待全部在途任务结束（含失败的）；不等待暂停期被挡下的任务。优雅关闭前调用（04 §9 关闭顺序）。 */
  drain(): Promise<void>;
  /** 当前已开始执行的任务数（观测用；不含暂停期被挡下的任务）。 */
  pendingCount(): number;
  /**
   * 暂停新写入：此后 `run` 提交的任务等到恢复后才进入各自的 key 链。
   * 暂停期间 `drain()` 只等待已经开始的在途任务——因此「先 pause 再 drain」不会死锁。
   * 支持嵌套：多次调用各自返回 resume，最后一个 resume 才真正放行。返回的 resume 幂等。
   * @returns 恢复函数。
   */
  pause(): () => void;
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

  /** 暂停闸门；null 表示未暂停。 */
  let gate: Promise<void> | null = null;
  let openGate: (() => void) | null = null;
  /** 当前持有的暂停数：嵌套 pause 时最后一个 resume 才放行。 */
  let pauseDepth = 0;

  function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
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
  }

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const blocked = gate;
      if (blocked === null) return enqueue(key, task);
      // 暂停期提交：先等闸门，暂不进入 key 链、也不计入 drain 的在途集合。
      // 若把等待者算作在途，`pauseWrites()`（pause → drain）会等待刚被自己挡下的写入而死锁。
      return blocked.then(() => enqueue(key, task));
    },
    async drain(): Promise<void> {
      await Promise.allSettled([...inflight]);
    },
    pendingCount(): number {
      return pending;
    },
    pause(): () => void {
      pauseDepth += 1;
      if (gate === null) {
        gate = new Promise<void>((resolve) => {
          openGate = resolve;
        });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pauseDepth -= 1;
        if (pauseDepth > 0) return;
        const resolve = openGate;
        gate = null;
        openGate = null;
        resolve?.();
      };
    },
  };
}
