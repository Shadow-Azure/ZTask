import { describe, expect, it } from "vitest";
import { createWriteQueue } from "@ztask/server";

describe("createWriteQueue", () => {
  it("同 key 严格串行：按提交顺序执行且不重叠", async () => {
    const queue = createWriteQueue();
    const events: string[] = [];
    let running = false;
    const task = (name: string, delayMs: number) => async () => {
      expect(running, `${name} 不应与其他任务重叠`).toBe(false);
      running = true;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(name);
      running = false;
    };
    await Promise.all([
      queue.run("t-1", task("a", 30)),
      queue.run("t-1", task("b", 5)),
      queue.run("t-1", task("c", 1)),
    ]);
    expect(events).toEqual(["a", "b", "c"]);
  });

  it("不同 key 并行执行", async () => {
    const queue = createWriteQueue();
    let inside = 0;
    let maxConcurrent = 0;
    const task = async () => {
      inside += 1;
      maxConcurrent = Math.max(maxConcurrent, inside);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inside -= 1;
    };
    await Promise.all([queue.run("t-1", task), queue.run("t-2", task)]);
    expect(maxConcurrent).toBe(2);
  });

  it("单个任务失败不阻塞同 key 后续任务", async () => {
    const queue = createWriteQueue();
    await expect(queue.run("t-1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(queue.run("t-1", async () => "ok")).resolves.toBe("ok");
  });

  it("drain 等待全部在途任务完成", async () => {
    const queue = createWriteQueue();
    const done: string[] = [];
    for (const key of ["t-1", "t-2", "t-3"]) {
      void queue.run(key, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        done.push(key);
      });
    }
    await queue.drain();
    expect(done.sort()).toEqual(["t-1", "t-2", "t-3"]);
  });
});
