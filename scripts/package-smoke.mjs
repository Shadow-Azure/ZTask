#!/usr/bin/env node
// 打包安装冒烟：在仓库外临时目录安装 npm pack 产物，真实启动服务并断言
// 健康检查、SPA、管理员 API 与重启持久化。CI 与本地共用；先执行 pnpm build。
//
//   pnpm package:smoke            # 结束后删除临时目录
//   pnpm package:smoke -- --keep  # 保留临时目录，便于人工查看/截图
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(repoRoot, "apps/ztask");
const keep = process.argv.includes("--keep");

const missing = ["apps/cli/dist/cli.js", "apps/web/dist/index.html"].filter(
  (relative) => !existsSync(path.join(repoRoot, relative)),
);
if (missing.length > 0) {
  console.error(`package:smoke 需要先构建：缺 ${missing.join("、")}；先执行 pnpm build`);
  process.exit(1);
}

/** 断言失败时抛出带场景名的错误。 */
function assert(condition, message) {
  if (!condition) throw new Error(`冒烟断言失败：${message}`);
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check().catch(() => null);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`等待超时：${label}`);
}

/** 解析子进程 stdout 里打印的管理端地址。 */
function watchBaseUrl(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`未打印管理端地址：${output}`)), 20000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const matched = /管理端：http:\/\/127\.0\.0\.1:(\d+)\//.exec(output);
      if (matched !== null) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${matched[1]}`);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`服务提前退出（code ${code}）：${output}`));
    });
  });
}

/** 启动打包后的 CLI，返回地址与停止函数。 */
async function startServer(cliPath, dataDir) {
  const child = spawn(process.execPath, [cliPath, "serve", "--port", "0", "--no-open", "--data-dir", dataDir], {
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  let base;
  try {
    base = await watchBaseUrl(child);
    await waitFor(
      async () => {
        const response = await fetch(`${base}/api/v1/health`);
        return response.ok ? response : null;
      },
      15000,
      `${base}/api/v1/health`,
    );
  } catch (cause) {
    child.kill("SIGKILL");
    throw cause;
  }
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 8000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (stderr.trim() !== "") process.stderr.write(stderr);
  };
  return { base, stop };
}

/** 发一次 JSON 请求并断言状态码。 */
async function call(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  assert(response.ok, `${pathname} 返回 ${response.status}：${text}`);
  return text === "" ? null : JSON.parse(text);
}

async function main() {
  const work = await mkdtemp(path.join(tmpdir(), "ztask-package-smoke-"));
  const packDir = path.join(work, "pack");
  const projectDir = path.join(work, "project");
  const dataDir = path.join(work, "data");
  const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  let server = null;
  try {
    console.log(`1. 打包 ztask ${packageJson.version}`);
    await mkdir(packDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    execFileSync("npm", ["pack", "--pack-destination", packDir], { cwd: packageDir, stdio: ["ignore", "inherit", "inherit"] });
    const tarballName = (await readdir(packDir)).find((entry) => entry.endsWith(".tgz"));
    assert(tarballName !== undefined, "npm pack 没有产出 .tgz");
    const tarball = path.join(packDir, tarballName);
    console.log(`   ${tarballName}`);

    const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    for (const required of ["package/dist/cli.js", "package/dist/web/index.html"]) {
      assert(files.includes(required), `tarball 缺 ${required}`);
    }
    assert(
      !files.some((file) => /^package\/(apps|packages|src)\//.test(file)),
      "tarball 混入 workspace 源码",
    );
    console.log(`   文件 ${files.length} 个，仅含 dist 与包内 README`);

    console.log("2. 在仓库外的干净目录安装 tarball");
    await writeFile(
      path.join(projectDir, "package.json"),
      `${JSON.stringify({ name: "ztask-package-smoke", version: "0.0.0", private: true }, null, 2)}\n`,
    );
    execFileSync("npm", ["install", "--no-audit", "--no-fund", tarball], { cwd: projectDir, stdio: "inherit" });

    const version = execFileSync("npx", ["--no-install", "ztask", "--version"], {
      cwd: projectDir,
      encoding: "utf8",
    }).trim();
    assert(version === packageJson.version, `npx ztask --version=${version}，期望 ${packageJson.version}`);
    console.log(`   npx ztask --version → ${version}`);

    const cliPath = path.join(projectDir, "node_modules/ztask/dist/cli.js");
    console.log("3. 启动打包服务并验证健康检查与 SPA");
    server = await startServer(cliPath, dataDir);
    const health = await call(server.base, "/api/v1/health");
    assert(health.status === "ok", "health.status 不是 ok");
    assert(health.version === packageJson.version, `health.version=${health.version}`);
    const html = await (await fetch(`${server.base}/`)).text();
    assert(html.includes('id="app"'), "首页不是 Vue 入口");
    const scriptPath = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
    assert(scriptPath !== undefined, "首页缺构建后的 JS 入口");
    const script = await fetch(`${server.base}${scriptPath}`);
    assert(script.ok, `静态资源 ${scriptPath} 返回 ${script.status}`);
    console.log(`   health ${health.version}，SPA 与静态资源 ${scriptPath} 正常`);

    console.log("4. 通过管理员 API 建夹/成员/任务");
    const folder = await call(server.base, "/api/v1/admin/folders", {
      method: "POST",
      body: { name: "单包冒烟任务夹", parentId: null },
    });
    const member = await call(server.base, "/api/v1/admin/members", {
      method: "POST",
      body: { name: "冒烟成员", role: "测试" },
    });
    await call(server.base, "/api/v1/admin/tasks", {
      method: "POST",
      body: {
        folderId: folder.id,
        parentId: null,
        description: "单包安装冒烟任务",
        ownerIds: [member.id],
        collaboratorIds: [],
        progress: 30,
        detail: "由 scripts/package-smoke.mjs 创建",
        importance: "mid",
        dueDate: "2026-12-31",
      },
    });
    const tasks = await call(server.base, `/api/v1/admin/tasks?folderId=${folder.id}`);
    assert(JSON.stringify(tasks).includes("单包安装冒烟任务"), "任务列表未包含冒烟任务");

    console.log("5. 重启后数据仍在");
    await server.stop();
    server = await startServer(cliPath, dataDir);
    const persisted = await call(server.base, `/api/v1/admin/tasks?folderId=${folder.id}`);
    assert(JSON.stringify(persisted).includes("单包安装冒烟任务"), "重启后任务丢失");
    console.log("   PASS");
  } finally {
    if (server !== null) await server.stop();
    if (keep) console.log(`临时目录保留：${work}`);
    else await rm(work, { recursive: true, force: true });
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
