// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_FAILURE, EXIT_OK, parseCliArgs, runInit, type InitOptions } from "@ztask/cli";

/**
 * `ztask init`：把 npm 全局可执行目录持久化到 PATH。
 * 测试用临时主目录与注入的 npm 前缀，绝不读写真实的 shell 启动文件。
 */

const homes: string[] = [];

async function makeHome(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "ztask-init-"));
  homes.push(home);
  return home;
}

function posixOptions(home: string, overrides: InitOptions = {}): InitOptions {
  return {
    platform: "darwin",
    homeDir: home,
    env: { PATH: "/usr/bin:/bin", SHELL: "/bin/zsh" } as NodeJS.ProcessEnv,
    resolveNpmPrefix: async () => "/opt/npm",
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("parseCliArgs init", () => {
  it("解析 init 子命令", () => {
    expect(parseCliArgs(["init"])).toEqual({ command: "init" });
  });
});

describe("runInit（POSIX）", () => {
  it("zsh：写入 ~/.zshrc，重复执行不重复追加", async () => {
    const home = await makeHome();
    const options = posixOptions(home);

    expect(await runInit(options)).toBe(EXIT_OK);
    const file = path.join(home, ".zshrc");
    const first = await readFile(file, "utf8");
    expect(first).toContain("# ztask init");
    expect(first).toContain(`export PATH='/opt/npm/bin':"$PATH"`);

    expect(await runInit(options)).toBe(EXIT_OK);
    expect(await readFile(file, "utf8")).toBe(first);
  });

  it("PATH 已包含该目录（含尾部斜杠）时不写启动文件", async () => {
    const home = await makeHome();
    const result = await runInit(
      posixOptions(home, { env: { PATH: "/usr/bin:/opt/npm/bin/:", SHELL: "/bin/zsh" } as NodeJS.ProcessEnv }),
    );

    expect(result).toBe(EXIT_OK);
    await expect(readFile(path.join(home, ".zshrc"), "utf8")).rejects.toThrow();
  });

  it("npx 调用时 npm 会前置 bin 目录，不据此跳过启动文件写入", async () => {
    const home = await makeHome();
    const env = {
      PATH: "/opt/npm/bin:/usr/bin:/bin",
      SHELL: "/bin/zsh",
      npm_lifecycle_event: "npx",
    } as NodeJS.ProcessEnv;

    expect(await runInit(posixOptions(home, { env }))).toBe(EXIT_OK);
    expect(await readFile(path.join(home, ".zshrc"), "utf8")).toContain(`export PATH='/opt/npm/bin'`);
  });

  it("bash 写 ~/.bashrc，fish 写 config.fish 并使用 fish_add_path", async () => {
    const bashHome = await makeHome();
    await runInit(
      posixOptions(bashHome, { env: { PATH: "/usr/bin", SHELL: "/bin/bash" } as NodeJS.ProcessEnv }),
    );
    expect(await readFile(path.join(bashHome, ".bashrc"), "utf8")).toContain(`export PATH='/opt/npm/bin'`);

    const fishHome = await makeHome();
    await runInit(
      posixOptions(fishHome, { env: { PATH: "/usr/bin", SHELL: "/opt/homebrew/bin/fish" } as NodeJS.ProcessEnv }),
    );
    expect(await readFile(path.join(fishHome, ".config", "fish", "config.fish"), "utf8")).toContain(
      "fish_add_path '/opt/npm/bin'",
    );
  });

  it("SHELL 缺失时退回 ~/.profile，并在文件末尾无换行时先补换行", async () => {
    const home = await makeHome();
    const profile = path.join(home, ".profile");
    await writeFile(profile, "alias ll='ls -l'", "utf8");

    expect(await runInit(posixOptions(home, { env: { PATH: "/usr/bin" } as NodeJS.ProcessEnv }))).toBe(EXIT_OK);
    expect(await readFile(profile, "utf8")).toBe(
      "alias ll='ls -l'\n\n# ztask init: 把 npm 全局可执行目录加入 PATH\nexport PATH='/opt/npm/bin':\"$PATH\"\n",
    );
  });

  it("启动文件已有配置但当前终端未加载：报告已配置且不重复写入", async () => {
    const home = await makeHome();
    const file = path.join(home, ".zshrc");
    const existing = "export PATH='/opt/npm/bin':\"$PATH\"\n";
    await writeFile(file, existing, "utf8");

    expect(await runInit(posixOptions(home))).toBe(EXIT_OK);
    expect(await readFile(file, "utf8")).toBe(existing);
  });

  it("npm 前缀变化（如切换 nvm）时追加新目录而不是被旧标记挡住", async () => {
    const home = await makeHome();
    const file = path.join(home, ".zshrc");
    await writeFile(file, "# ztask init: 把 npm 全局可执行目录加入 PATH\nexport PATH='/old/prefix/bin':\"$PATH\"\n", "utf8");

    expect(await runInit(posixOptions(home))).toBe(EXIT_OK);
    const content = await readFile(file, "utf8");
    expect(content).toContain("export PATH='/old/prefix/bin'");
    expect(content).toContain("export PATH='/opt/npm/bin'");
  });

  it("npm 前缀不可读或写入失败：退出码 1", async () => {
    const home = await makeHome();
    expect(
      await runInit(
        posixOptions(home, {
          resolveNpmPrefix: async () => {
            throw new Error("npm: command not found");
          },
        }),
      ),
    ).toBe(EXIT_FAILURE);

    expect(
      await runInit(
        posixOptions(home, {
          appendTextFile: async () => {
            throw new Error("EACCES");
          },
        }),
      ),
    ).toBe(EXIT_FAILURE);
  });
});

describe("runInit（Windows）", () => {
  const windowsOptions = (home: string, overrides: InitOptions = {}): InitOptions => ({
    platform: "win32",
    homeDir: home,
    env: { Path: "C:\\Windows\\system32" } as NodeJS.ProcessEnv,
    resolveNpmPrefix: async () => "C:\\Users\\me\\AppData\\Roaming\\npm",
    ...overrides,
  });

  it("把 npm 前缀目录交给用户 PATH 更新，不写 shell 文件", async () => {
    const home = await makeHome();
    const updateWindowsPath = vi.fn(async () => true);

    expect(await runInit(windowsOptions(home, { updateWindowsPath }))).toBe(EXIT_OK);
    expect(updateWindowsPath).toHaveBeenCalledWith("C:\\Users\\me\\AppData\\Roaming\\npm");
  });

  it("用户 PATH 已包含该目录时仍成功退出", async () => {
    const home = await makeHome();
    expect(await runInit(windowsOptions(home, { updateWindowsPath: async () => false }))).toBe(EXIT_OK);
  });

  it("Windows 用户 PATH 已包含目录时不调用更新", async () => {
    const home = await makeHome();
    const updateWindowsPath = vi.fn(async () => true);
    const env = { Path: "C:\\Users\\me\\AppData\\Roaming\\npm;" } as NodeJS.ProcessEnv;

    expect(await runInit(windowsOptions(home, { env, updateWindowsPath }))).toBe(EXIT_OK);
    expect(updateWindowsPath).not.toHaveBeenCalled();
  });
});
