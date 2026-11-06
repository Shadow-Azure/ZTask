import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWebDist } from "@ztask/cli";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ztask-web-dist-"));
  created.push(dir);
  return dir;
}

/** 造一个含 index.html 的静态目录，模拟 Vite 构建产物。 */
async function makeWebFixture(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), "<!doctype html><div id=\"app\"></div>", "utf8");
  return dir;
}

describe("resolveWebDist", () => {
  it("发布包布局：dist/cli.js 旁的 dist/web", async () => {
    const dist = path.join(await tempDir(), "dist");
    const web = await makeWebFixture(path.join(dist, "web"));
    expect(resolveWebDist(dist)).toBe(web);
  });

  it("monorepo 布局：apps/cli/dist 向上两层到 apps/web/dist", async () => {
    const apps = path.join(await tempDir(), "apps");
    const cliDist = path.join(apps, "cli", "dist");
    const web = await makeWebFixture(path.join(apps, "web", "dist"));
    await mkdir(cliDist, { recursive: true });
    expect(resolveWebDist(cliDist)).toBe(web);
  });

  it("两种布局都不存在时退化为纯 API 模式", async () => {
    const dist = path.join(await tempDir(), "dist");
    await mkdir(dist, { recursive: true });
    expect(resolveWebDist(dist)).toBeNull();
  });
});
