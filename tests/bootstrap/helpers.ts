import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** 建一个一次性数据目录（真实存在，避免锁/初始化逻辑被绕过）。 */
export async function makeTempDataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "ztask-bootstrap-"));
}

/** 造一个最小可服务的静态目录（index.html），用于 SPA fallback 测试。 */
export async function makeFixtureStaticRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ztask-static-"));
  await writeFile(path.join(root, "index.html"), "<!doctype html><html><body>ztask-shell</body></html>", "utf8");
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "assets", "app.js"), "console.log(1)", "utf8");
  return root;
}
