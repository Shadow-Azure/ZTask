// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { NetworkInterfaceInfo, NetworkState } from "@ztask/shared";
import type { NetworkListenerHandle, NetworkService, StartNetworkListener } from "@ztask/server";

/**
 * tests/sharing 的共享夹具：临时目录、可注入失败/延迟的 listener fake、网络状态 stub。
 * 纪律：全部使用临时目录；不监听真实 0.0.0.0；LAN 语义通过 fake startListener 覆盖，
 * 因此 enable 的「必须具体 LAN 地址」校验仍然真实执行。
 */

/** 一次性临时数据目录（不预先创建，验证服务自建目录的能力由各 spec 决定）。 */
export async function tmpDataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "ztask-sharing-"));
}

/** 测试使用的固定网卡列表：一个 IPv4 与一个非链路本地 IPv6。 */
export const FAKE_INTERFACES: NetworkInterfaceInfo[] = [
  { name: "en0", address: "192.168.1.5" },
  { name: "en1", address: "fd00::5" },
];

/** 一次 fake listener 启动记录。 */
export interface FakeListenerRecord {
  host: string;
  port: number;
  closed: boolean;
}

/** fake startListener 集合：可记录调用、注入失败与延迟。 */
export interface ListenerFake {
  /** 按调用顺序记录 start/close 事件，用于断言「先起新后关旧」。 */
  events: string[];
  records: FakeListenerRecord[];
  /** 这些 host 的 start 会抛错（模拟 IP 失效/端口占用）。 */
  failHosts: Set<string>;
  /** 每次 start 的人工延迟（毫秒），用于并发串行化用例。 */
  delayMs: number;
  start: StartNetworkListener;
}

/**
 * 创建 fake listener 工厂；返回的 handle.close 只标记记录，不触达真实 socket。
 * @returns ListenerFake。
 */
export function createListenerFake(): ListenerFake {
  const fake: ListenerFake = {
    events: [],
    records: [],
    failHosts: new Set<string>(),
    delayMs: 0,
    start: async (host, port): Promise<NetworkListenerHandle> => {
      fake.events.push(`start ${host}:${port}`);
      if (fake.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, fake.delayMs));
      if (fake.failHosts.has(host)) throw new Error(`bind failed: ${host}`);
      const record: FakeListenerRecord = { host, port, closed: false };
      fake.records.push(record);
      return {
        port,
        async close(): Promise<void> {
          record.closed = true;
          fake.events.push(`close ${host}:${port}`);
        },
      };
    },
  };
  return fake;
}

/** 可切换 running 的网络服务 stub：用于只关心链接生命周期的 spec。 */
export interface StubNetworkService extends NetworkService {
  setRunning(running: boolean): void;
}

/**
 * 网络服务 stub：state() 与 shareBaseUrl() 始终自洽（只有 running 才给 URL）。
 * @param options 初始 running/host/port 与网卡列表。
 * @returns StubNetworkService。
 */
export function createStubNetworkService(options: {
  running: boolean;
  host?: string;
  port?: number;
  interfaces?: NetworkInterfaceInfo[];
  loopbackHost?: string;
  loopbackPort?: number;
}): StubNetworkService {
  const host = options.host ?? "192.168.1.5";
  const port = options.port ?? 8123;
  const loopbackHost = options.loopbackHost ?? "127.0.0.1";
  const loopbackPort = options.loopbackPort ?? 8123;
  let running = options.running;

  function state(): NetworkState {
    return {
      loopbackUrl: `http://${loopbackHost}:${loopbackPort}`,
      interfaces: options.interfaces ?? FAKE_INTERFACES,
      shareListener: {
        enabled: running,
        running,
        degraded: false,
        host,
        port,
        shareBaseUrl: running ? `http://${host}:${port}` : null,
        error: null,
      },
    };
  }

  return {
    state,
    async enable(): Promise<NetworkState> {
      running = true;
      return state();
    },
    async disable(): Promise<NetworkState> {
      running = false;
      return state();
    },
    async restore(): Promise<NetworkState> {
      return state();
    },
    shareBaseUrl(): string | null {
      return running ? `http://${host}:${port}` : null;
    },
    isRunning(): boolean {
      return running;
    },
    async close(): Promise<void> {
      running = false;
    },
    setRunning(next: boolean): void {
      running = next;
    },
  };
}

/** 从 issued.url 中取出 raw token（`.../#/s/<token>`）。 */
export function tokenFromUrl(url: string): string {
  const marker = "/#/s/";
  const index = url.lastIndexOf(marker);
  if (index < 0) throw new Error(`share url 不含 ${marker}: ${url}`);
  return url.slice(index + marker.length);
}

/** 管理端：创建成员并返回 id。 */
export async function createMemberViaApi(app: FastifyInstance, name: string, isAdmin = false): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/admin/members",
    payload: { name, ...(isAdmin ? { isAdmin: true } : {}) },
  });
  if (response.statusCode !== 201) throw new Error(`createMember failed: ${response.statusCode} ${response.body}`);
  return (response.json() as { id: string }).id;
}

/** 用 token 走真实 POST /share/session 换 Cookie；返回 `name=value`。 */
export async function exchangeCookie(app: FastifyInstance, token: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/share/session", payload: { token } });
  if (response.statusCode !== 201) throw new Error(`token exchange failed: ${response.statusCode} ${response.body}`);
  const header = response.headers["set-cookie"];
  const setCookie = Array.isArray(header) ? header[0] : header;
  if (!setCookie) throw new Error("missing Set-Cookie");
  return setCookie.split(";")[0]!;
}
