// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_FAILURE, EXIT_OK, parseCliArgs, runInit, type InitOptions } from "@ztask/cli";

/**
 * `ztask init`：引导用户把 npm 全局可执行目录持久化到 PATH。
 * 测试用临时主目录与注入的 npm 前缀/确认函数，绝不读写真实的 shell 启动文件。
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
    confirm: async () => true,
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
  it("解析 init 子命令与 --yes", () => {
    expect(parseCliArgs(["init"])).toEqual({ command: "init", yes: false });
    expect(parseCliArgs(["init", "--yes"])).toEqual({ command: "init", yes: true });
  });
});

describe("runInit（POSIX）", () => {
  it("用户确认后写入 ~/.zshrc，重复执行不重复追加", async () => {
    const home = await makeHome();
    const options = posixOptions(home);
    const confirm = vi.fn(async () => true);
    options.confirm = confirm;

    expect(await runInit(options)).toBe(EXIT_OK);
    expect(confirm).toHaveBeenCalledTimes(1);
    const file = path.join(home, ".zshrc");
    const first = await readFile(file, "utf8");
    expect(first).toContain("# ztask init");
    expect(first).toContain(`export PATH='/opt/npm/bin':"$PATH"`);

    expect(await runInit(options)).toBe(EXIT_OK);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await readFile(file, "utf8")).toBe(first);
  });

  it("用户拒绝时退出码 0 且不修改启动文件", async () => {
    const home = await makeHome();
    const result = await runInit(posixOptions(home, { confirm: async () => false }));

    expect(result).toBe(EXIT_OK);
    await expect(readFile(path.join(home, ".zshrc"), "utf8")).rejects.toThrow();
  });

  it("--yes 跳过确认直接写入", async () => {
    const home = await makeHome();
    const confirm = vi.fn(async () => false);
    const result = await runInit(posixOptions(home, { assumeYes: true, confirm }));

    expect(result).toBe(EXIT_OK);
    expect(confirm).not.toHaveBeenCalled();
    expect(await readFile(path.join(home, ".zshrc"), "utf8")).toContain(`export PATH='/opt/npm/bin'`);
  });

  it("PATH 已包含该目录（含尾部斜杠）时只提醒，不询问也不写入", async () => {
    const home = await makeHome();
    const confirm = vi.fn(async () => true);
    const env = { PATH: "/usr/bin:/opt/npm/bin/:", SHELL: "/bin/zsh" } as NodeJS.ProcessEnv;

    expect(await runInit(posixOptions(home, { env, confirm }))).toBe(EXIT_OK);
    expect(confirm).not.toHaveBeenCalled();
    await expect(readFile(path.join(home, ".zshrc"), "utf8")).rejects.toThrow();
  });

  it("npx 调用时 npm 会前置 bin 目录，仍会询问并写入启动文件", async () => {
    const home = await makeHome();
    const confirm = vi.fn(async () => true);
    const env = {
      PATH: "/opt/npm/bin:/usr/bin:/bin",
      SHELL: "/bin/zsh",
      npm_lifecycle_event: "npx",
    } as NodeJS.ProcessEnv;

    expect(await runInit(posixOptions(home, { env, confirm }))).toBe(EXIT_OK);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(home, ".zshrc"), "utf8")).toContain(`export PATH='/opt/npm/bin'`);
  });

  it("启动文件已有配置时只提醒，不询问也不重复写入，并给出 source 提示", async () => {
    const home = await makeHome();
    const file = path.join(home, ".zshrc");
    const existing = "export PATH='/opt/npm/bin':\"$PATH\"\n";
    await writeFile(file, existing, "utf8");
    const confirm = vi.fn(async () => true);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    expect(await runInit(posixOptions(home, { confirm }))).toBe(EXIT_OK);
    expect(confirm).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe(existing);
    expect(logs.join("\n")).toContain(`source '${file}'`);
  });

  it("确认前显示目标启动文件，写入后给出 source 与当前会话命令", async () => {
    const home = await makeHome();
    const file = path.join(home, ".zshrc");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    expect(await runInit(posixOptions(home))).toBe(EXIT_OK);
    const text = logs.join("\n");
    expect(text).toContain(`将把该目录加入 PATH，并写入 ${file}。`);
    expect(text).toContain(`source '${file}'`);
    expect(text).toContain(`export PATH='/opt/npm/bin':"$PATH"`);
  });

  it("npm 前缀变化（如切换 nvm）时询问并追加新目录", async () => {
    const home = await makeHome();
    const file = path.join(home, ".zshrc");
    await writeFile(file, "# ztask init: 把 npm 全局可执行目录加入 PATH\nexport PATH='/old/prefix/bin':\"$PATH\"\n", "utf8");

    expect(await runInit(posixOptions(home))).toBe(EXIT_OK);
    const content = await readFile(file, "utf8");
    expect(content).toContain("export PATH='/old/prefix/bin'");
    expect(content).toContain("export PATH='/opt/npm/bin'");
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

  it("非交互环境无法确认时退出码 1", async () => {
    const home = await makeHome();
    const result = await runInit(
      posixOptions(home, {
        confirm: async () => {
          throw new Error("当前不是交互终端，无法请求确认；可加 --yes 直接写入");
        },
      }),
    );

    expect(result).toBe(EXIT_FAILURE);
    await expect(readFile(path.join(home, ".zshrc"), "utf8")).rejects.toThrow();
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
    confirm: async () => true,
    isWindowsPathConfigured: async () => false,
    ...overrides,
  });

  it("用户 PATH 已包含该目录时只提醒，不询问也不写入", async () => {
    const home = await makeHome();
    const confirm = vi.fn(async () => true);
    const addWindowsPath = vi.fn(async () => undefined);

    expect(
      await runInit(
        windowsOptions(home, {
          confirm,
          addWindowsPath,
          isWindowsPathConfigured: async () => true,
        }),
      ),
    ).toBe(EXIT_OK);
    expect(confirm).not.toHaveBeenCalled();
    expect(addWindowsPath).not.toHaveBeenCalled();
  });

  it("用户确认后更新当前用户 PATH，不写 shell 文件", async () => {
    const home = await makeHome();
    const addWindowsPath = vi.fn(async () => undefined);

    expect(await runInit(windowsOptions(home, { addWindowsPath }))).toBe(EXIT_OK);
    expect(addWindowsPath).toHaveBeenCalledWith("C:\\Users\\me\\AppData\\Roaming\\npm");
  });

  it("用户拒绝时不更新用户 PATH", async () => {
    const home = await makeHome();
    const addWindowsPath = vi.fn(async () => undefined);

    expect(
      await runInit(windowsOptions(home, { addWindowsPath, confirm: async () => false })),
    ).toBe(EXIT_OK);
    expect(addWindowsPath).not.toHaveBeenCalled();
  });

  it("--yes 跳过确认直接更新", async () => {
    const home = await makeHome();
    const confirm = vi.fn(async () => false);
    const addWindowsPath = vi.fn(async () => undefined);

    expect(await runInit(windowsOptions(home, { assumeYes: true, confirm, addWindowsPath }))).toBe(EXIT_OK);
    expect(confirm).not.toHaveBeenCalled();
    expect(addWindowsPath).toHaveBeenCalledTimes(1);
  });

  it("当前进程 PATH 已包含目录时无需查询用户 PATH", async () => {
    const home = await makeHome();
    const isWindowsPathConfigured = vi.fn(async () => false);
    const env = { Path: "C:\\Users\\me\\AppData\\Roaming\\npm;" } as NodeJS.ProcessEnv;

    expect(await runInit(windowsOptions(home, { env, isWindowsPathConfigured }))).toBe(EXIT_OK);
    expect(isWindowsPathConfigured).not.toHaveBeenCalled();
  });
});
