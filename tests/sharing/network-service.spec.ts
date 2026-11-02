// @vitest-environment node
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectShareInterfaces,
  createNetworkService,
  type NetworkService,
  type NetworkServiceOptions,
} from "@ztask/server";
import { FAKE_INTERFACES, createListenerFake, tmpDataDir, type ListenerFake } from "./support/fakes.js";

/**
 * NetworkService 单测（07 §3.3、07 §10 网络用例）：
 * 全部使用 fake startListener，不真实监听任何地址；network.json 落在临时目录。
 */

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface ServiceHarness {
  dataDir: string;
  fake: ListenerFake;
  service: NetworkService;
  /** 切换后控制原子写失败（writeJsonAtomic 的 beforeRename 缝）。 */
  setWriteFailure(fail: boolean): void;
}

async function makeService(overrides: Partial<Pick<NetworkServiceOptions, "loopbackPort" | "listInterfaces">> = {}): Promise<ServiceHarness> {
  const dataDir = await tmpDataDir();
  createdDirs.push(dataDir);
  const fake = createListenerFake();
  let failWrites = false;
  const service = createNetworkService({
    dataDir,
    loopbackHost: "127.0.0.1",
    loopbackPort: overrides.loopbackPort ?? 8123,
    listInterfaces: overrides.listInterfaces ?? (() => FAKE_INTERFACES),
    startListener: fake.start,
    writeHooks: {
      beforeRename: () => {
        if (failWrites) throw new Error("injected write failure");
      },
    },
  });
  return {
    dataDir,
    fake,
    service,
    setWriteFailure(fail: boolean): void {
      failWrites = fail;
    },
  };
}

async function readNetworkJson(dataDir: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dataDir, "network.json"), "utf8")) as unknown;
}

async function seedNetworkJson(dataDir: string, value: unknown): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "network.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("collectShareInterfaces（非 internal 具体地址）", () => {
  it("过滤 loopback/link-local/duplicate，保留 IPv4 与非链路本地 IPv6，并稳定排序", () => {
    const result = collectShareInterfaces({
      lo0: [
        { address: "127.0.0.1", family: "IPv4", internal: true },
        { address: "::1", family: "IPv6", internal: true },
      ],
      en0: [
        { address: "192.168.1.5", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
        { address: "fd00::5", family: 6, internal: false },
      ],
      en1: [{ address: "192.168.1.5", family: 4, internal: false }],
      utun9: [{ address: "169.254.10.7", family: "IPv4", internal: false }],
    });

    expect(result).toEqual([
      { name: "en0", address: "192.168.1.5" },
      { name: "en0", address: "fd00::5" },
      { name: "utun9", address: "169.254.10.7" },
    ]);
  });
});

describe("state（05 §2.3）", () => {
  it("初始 disabled：loopbackUrl、interfaces、null shareBaseUrl", async () => {
    const { service } = await makeService();
    const state = service.state();
    expect(state.loopbackUrl).toBe("http://127.0.0.1:8123");
    expect(state.interfaces).toEqual(FAKE_INTERFACES);
    expect(state.shareListener).toEqual({
      enabled: false,
      running: false,
      degraded: false,
      host: null,
      port: null,
      shareBaseUrl: null,
      error: null,
    });
  });

  it("loopbackPort 支持 getter（port 0 场景取实际端口）", async () => {
    let actual = 0;
    const { service } = await makeService({ loopbackPort: () => actual });
    actual = 54321;
    expect(service.state().loopbackUrl).toBe("http://127.0.0.1:54321");
  });
});

describe("enable（07 §3.3）", () => {
  it("成功：先 bind 再原子写 network.json，running 时才有 shareBaseUrl", async () => {
    const { dataDir, fake, service } = await makeService();

    const state = await service.enable("192.168.1.5", 8123);
    expect(state.shareListener).toEqual({
      enabled: true,
      running: true,
      degraded: false,
      host: "192.168.1.5",
      port: 8123,
      shareBaseUrl: "http://192.168.1.5:8123",
      error: null,
    });
    expect(service.shareBaseUrl()).toBe("http://192.168.1.5:8123");
    expect(service.isRunning()).toBe(true);
    expect(fake.records).toHaveLength(1);
    expect(await readNetworkJson(dataDir)).toEqual({
      formatVersion: 1,
      shareListener: { enabled: true, host: "192.168.1.5", port: 8123, shareBaseUrl: "http://192.168.1.5:8123" },
    });
  });

  it("IPv6 具体地址以方括号进入 URL", async () => {
    const { service } = await makeService();
    const state = await service.enable("fd00::5", 8123);
    expect(state.shareListener.shareBaseUrl).toBe("http://[fd00::5]:8123");
  });

  it("同 host/port 幂等：不重复 bind", async () => {
    const { fake, service } = await makeService();
    await service.enable("192.168.1.5", 8123);
    await service.enable("192.168.1.5", 8123);
    expect(fake.records).toHaveLength(1);
    expect(fake.events).toEqual(["start 192.168.1.5:8123"]);
  });

  it("非法/非本机/wildcard/loopback 地址与越界端口 → 422 LAN_INTERFACE_INVALID，不 bind、不写文件", async () => {
    const { dataDir, fake, service } = await makeService();
    const cases: Array<[string, number]> = [
      ["127.0.0.1", 8123],
      ["localhost", 8123],
      ["0.0.0.0", 8123],
      ["::", 8123],
      ["", 8123],
      ["10.9.9.9", 8123],
      ["192.168.1.5", 0],
      ["192.168.1.5", 65536],
      ["192.168.1.5", 3.5],
    ];
    for (const [host, port] of cases) {
      await expect(service.enable(host, port)).rejects.toMatchObject({
        statusCode: 422,
        code: "LAN_INTERFACE_INVALID",
      });
    }
    expect(fake.events).toEqual([]);
    await expect(access(path.join(dataDir, "network.json"))).rejects.toThrow();
    expect(service.state().shareListener.running).toBe(false);
  });

  it("bind 失败 → 422 且不写 network.json、保持旧运行态", async () => {
    const { dataDir, fake, service } = await makeService();
    await service.enable("192.168.1.5", 8123);
    const before = service.state();

    fake.failHosts.add("fd00::5");
    await expect(service.enable("fd00::5", 8123)).rejects.toMatchObject({
      statusCode: 422,
      code: "LAN_INTERFACE_INVALID",
    });

    expect(service.state()).toEqual(before);
    expect(fake.records[0]!.closed).toBe(false);
    expect(await readNetworkJson(dataDir)).toMatchObject({ shareListener: { host: "192.168.1.5", enabled: true } });
  });

  it("写配置失败回滚：关闭新 listener、保持 disabled、不落 network.json", async () => {
    const { dataDir, fake, service, setWriteFailure } = await makeService();
    setWriteFailure(true);

    await expect(service.enable("192.168.1.5", 8123)).rejects.toMatchObject({
      statusCode: 500,
      code: "INTERNAL_ERROR",
    });

    expect(fake.records[0]!.closed).toBe(true);
    expect(service.state().shareListener).toMatchObject({ enabled: false, running: false, shareBaseUrl: null });
    expect(service.shareBaseUrl()).toBeNull();
    await expect(access(path.join(dataDir, "network.json"))).rejects.toThrow();
  });

  it("切换地址：先启动新 listener，写配置成功后才关闭旧 listener", async () => {
    const { dataDir, fake, service } = await makeService();
    await service.enable("192.168.1.5", 8123);
    const state = await service.enable("fd00::5", 8123);

    expect(fake.events).toEqual(["start 192.168.1.5:8123", "start fd00::5:8123", "close 192.168.1.5:8123"]);
    expect(fake.records[0]!.closed).toBe(true);
    expect(fake.records[1]!.closed).toBe(false);
    expect(state.shareListener).toMatchObject({
      running: true,
      host: "fd00::5",
      shareBaseUrl: "http://[fd00::5]:8123",
    });
    expect(await readNetworkJson(dataDir)).toMatchObject({ shareListener: { host: "fd00::5", enabled: true } });
  });

  it("切换地址写配置失败：只关闭新入口，旧入口继续服务", async () => {
    const { fake, service, setWriteFailure } = await makeService();
    await service.enable("192.168.1.5", 8123);
    setWriteFailure(true);

    await expect(service.enable("fd00::5", 8123)).rejects.toMatchObject({
      statusCode: 500,
      code: "INTERNAL_ERROR",
    });

    expect(fake.records[0]!.closed).toBe(false);
    expect(fake.records[1]!.closed).toBe(true);
    expect(fake.events.at(-1)).toBe("close fd00::5:8123");
    expect(service.state().shareListener).toMatchObject({
      running: true,
      host: "192.168.1.5",
      shareBaseUrl: "http://192.168.1.5:8123",
    });
  });

  it("并发 enable 串行化：最终只保留最后一个入口", async () => {
    const { fake, service } = await makeService();
    fake.delayMs = 10;

    const first = service.enable("192.168.1.5", 8123);
    const second = service.enable("fd00::5", 8123);
    await Promise.all([first, second]);

    expect(fake.records).toHaveLength(2);
    expect(fake.records[0]!.closed).toBe(true);
    expect(fake.records[1]!.closed).toBe(false);
    expect(service.state().shareListener.host).toBe("fd00::5");
  });
});

describe("disable（04 §9）", () => {
  it("先写 enabled=false 再关闭 listener；保留 host/port 便于展示", async () => {
    const { dataDir, fake, service } = await makeService();
    await service.enable("192.168.1.5", 8123);

    const state = await service.disable();
    expect(fake.records[0]!.closed).toBe(true);
    expect(state.shareListener).toEqual({
      enabled: false,
      running: false,
      degraded: false,
      host: "192.168.1.5",
      port: 8123,
      shareBaseUrl: null,
      error: null,
    });
    expect(await readNetworkJson(dataDir)).toMatchObject({
      shareListener: { enabled: false, host: "192.168.1.5", port: 8123 },
    });
  });

  it("写失败：保持旧入口运行并抛 500，不吊销任何状态", async () => {
    const { fake, service, setWriteFailure } = await makeService();
    await service.enable("192.168.1.5", 8123);
    setWriteFailure(true);

    await expect(service.disable()).rejects.toMatchObject({ statusCode: 500, code: "INTERNAL_ERROR" });
    expect(fake.records[0]!.closed).toBe(false);
    expect(service.state().shareListener).toMatchObject({
      enabled: true,
      running: true,
      shareBaseUrl: "http://192.168.1.5:8123",
    });
  });

  it("已关闭时幂等返回，不重复写文件/关闭", async () => {
    const { fake, service } = await makeService();
    const state = await service.disable();
    expect(state.shareListener.running).toBe(false);
    expect(fake.events).toEqual([]);
  });
});

describe("restore（启动恢复）", () => {
  it("network.json enabled：恢复 running", async () => {
    const { dataDir, fake, service } = await makeService();
    await seedNetworkJson(dataDir, {
      formatVersion: 1,
      shareListener: { enabled: true, host: "192.168.1.5", port: 8123, shareBaseUrl: "http://192.168.1.5:8123" },
    });

    const state = await service.restore();
    expect(fake.events).toEqual(["start 192.168.1.5:8123"]);
    expect(state.shareListener).toMatchObject({
      enabled: true,
      running: true,
      degraded: false,
      shareBaseUrl: "http://192.168.1.5:8123",
    });
  });

  it("恢复失败：degraded、shareBaseUrl=null、错误脱敏（不含 dataDir），loopback 仍可用", async () => {
    const { dataDir, fake, service } = await makeService();
    await seedNetworkJson(dataDir, {
      formatVersion: 1,
      shareListener: { enabled: true, host: "192.168.1.5", port: 8123, shareBaseUrl: "http://192.168.1.5:8123" },
    });
    fake.failHosts.add("192.168.1.5");

    const state = await service.restore();
    expect(state.loopbackUrl).toBe("http://127.0.0.1:8123");
    expect(state.shareListener).toMatchObject({
      enabled: true,
      running: false,
      degraded: true,
      shareBaseUrl: null,
      host: "192.168.1.5",
      port: 8123,
    });
    expect(state.shareListener.error).toBeTruthy();
    expect(state.shareListener.error).not.toContain(dataDir);
    expect(service.shareBaseUrl()).toBeNull();
    expect(service.isRunning()).toBe(false);
  });

  it("文件缺失/损坏按 disabled 处理，不抛错", async () => {
    const { dataDir, service } = await makeService();
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, "network.json"), "{ this is not json", "utf8");

    const state = await service.restore();
    expect(state.shareListener).toMatchObject({ enabled: false, running: false, degraded: false, error: null });
    expect(service.shareBaseUrl()).toBeNull();
  });

  it("enabled 但缺少 host/port 的不可执行配置按 disabled 处理", async () => {
    const { dataDir, service } = await makeService();
    await seedNetworkJson(dataDir, {
      formatVersion: 1,
      shareListener: { enabled: true, host: null, port: null, shareBaseUrl: null },
    });
    const state = await service.restore();
    expect(state.shareListener).toMatchObject({ enabled: false, running: false, degraded: false });
  });
});

describe("close / shareBaseUrl 语义", () => {
  it("shareBaseUrl 仅 running 时有值；close 关闭入口但不改 network.json", async () => {
    const { dataDir, service } = await makeService();
    expect(service.shareBaseUrl()).toBeNull();

    await service.enable("192.168.1.5", 8123);
    expect(service.shareBaseUrl()).toBe("http://192.168.1.5:8123");

    await service.close();
    expect(service.isRunning()).toBe(false);
    expect(service.shareBaseUrl()).toBeNull();
    expect(await readNetworkJson(dataDir)).toMatchObject({ shareListener: { enabled: true } });
  });
});
