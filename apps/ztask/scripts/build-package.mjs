#!/usr/bin/env node
// 把 CLI / server / shared 的构建产物与预构建 Web 收进单个可发布包。
// 只打包 workspace 源码；fastify、@fastify/*、commander 等第三方依赖保持
// external，由 package.json 的 dependencies 在安装时解析。
import { cp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "../..");
const cliDist = path.join(repoRoot, "apps/cli/dist");
const webDist = path.join(repoRoot, "apps/web/dist");
const outDir = path.join(packageDir, "dist");

const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
const cliPackageJson = JSON.parse(await readFile(path.join(repoRoot, "apps/cli/package.json"), "utf8"));

if (packageJson.version !== cliPackageJson.version) {
  throw new Error(
    `apps/ztask 版本 ${packageJson.version} 与 @ztask/cli 版本 ${cliPackageJson.version} 不一致；先统一版本再打包`,
  );
}

const entry = path.join(cliDist, "cli.js");
const missing = [entry, path.join(webDist, "index.html")].filter((file) => !existsSync(file));
if (missing.length > 0) {
  throw new Error(
    `打包前缺少构建产物：${missing.join("、")}；先在仓库根执行 pnpm build（需要 @ztask/web 构建完成）`,
  );
}

await rm(outDir, { recursive: true, force: true });
await build({
  entryPoints: [entry],
  outdir: outDir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // 第三方依赖不打进单文件，避免 fastify 的插件解析与原生依赖在 bundle 内失真。
  external: Object.keys(packageJson.dependencies),
  legalComments: "none",
  logLevel: "info",
});

await cp(webDist, path.join(outDir, "web"), { recursive: true });

console.log(`ztask ${packageJson.version} 打包完成：${path.join(outDir, "cli.js")}（含 dist/web）`);
