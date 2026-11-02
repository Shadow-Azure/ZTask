// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { nextTick } from "vue";
import { mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type {
  AdminMember,
  AdminMemberShareLink,
  ApiErrorCode,
  NetworkState,
  ShareListenerState,
} from "@ztask/shared";
import App from "../../apps/web/src/App.vue";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";
import { clearToasts } from "../../apps/web/src/components/ui/toast";

/**
 * 成员管理页的分享链接生命周期与局域网分享面板（08 §5、05 §4.5–4.9、02 §3.3）：
 * 三态渲染、生成后仅本次会话可见完整 URL、重置/吊销确认 Dialog、
 * LAN 未开启的引导、网络面板开启/切换/关闭/失败保留状态，以及顶栏 LAN chip 三态。
 */

type ForcedError = { status: number; code: ApiErrorCode; message: string };

interface FetchCall {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}

const API = "/api/v1/admin";

const originalFetch = globalThis.fetch;

let net: NetworkState;
let members: AdminMember[];
let forcedErrors: { generate?: ForcedError; rotate?: ForcedError; enable?: ForcedError };
/** GET share-link 的权威态覆盖：模拟列表过期（列表未生成、服务端已有 active）。 */
let shareLinkOverrides: Record<string, AdminMemberShareLink | null>;
/** 模拟服务不可达：GET /admin/network 返回 500，用于顶栏 chip 的 down 态。 */
let networkDown = false;
let fetchCalls: FetchCall[];
let issuedCount = 0;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorResponse(error: ForcedError): Response {
  return jsonResponse(error.status, {
    error: { code: error.code, message: error.message, requestId: "r-test" },
  });
}

function listener(overrides: Partial<ShareListenerState> = {}): ShareListenerState {
  return {
    enabled: false,
    running: false,
    degraded: false,
    host: null,
    port: null,
    shareBaseUrl: null,
    error: null,
    ...overrides,
  };
}

function networkWith(overrides: Partial<ShareListenerState> = {}): NetworkState {
  return {
    loopbackUrl: "http://127.0.0.1:8123",
    interfaces: [
      { name: "en0", address: "192.168.1.5" },
      { name: "en1", address: "10.0.0.8" },
    ],
    shareListener: listener(overrides),
  };
}

/** 把测试夹具切到「LAN 已运行」：生成链接前客户端会先确认 running（08 §5）。 */
function lanRunning(port = 8123): void {
  net = networkWith({
    enabled: true,
    running: true,
    host: "192.168.1.5",
    port,
    shareBaseUrl: `http://192.168.1.5:${port}`,
  });
}

function makeMember(id: string, name: string, shareLink: AdminMemberShareLink | null = null): AdminMember {
  return {
    id,
    name,
    role: "成员",
    color: "#2f6fe0",
    archivedAt: null,
    counts: { owned: 0, collaborated: 0 },
    shareLink,
  };
}

function activeLink(overrides: Partial<AdminMemberShareLink> = {}): AdminMemberShareLink {
  return {
    status: "active",
    createdAt: "2026-11-01T05:00:00.000Z",
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
}

function revokedLink(overrides: Partial<AdminMemberShareLink> = {}): AdminMemberShareLink {
  return {
    status: "revoked",
    createdAt: "2026-11-01T05:00:00.000Z",
    revokedAt: "2026-11-01T06:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

/** 服务端发布的完整 URL：与生产同形（`/#/s/<43 字符 base64url>`），token 每次不同。 */
function issueUrl(_memberId: string): string {
  issuedCount += 1;
  const state = net.shareListener;
  const token = randomBytes(32).toString("base64url");
  return `http://${state.host ?? "192.168.1.5"}:${state.port ?? 8123}/#/s/${token}`;
}

/** 记录调用并模拟管理端网络/成员/分享链接端点（m4 前端契约测试用）。 */
async function handleRequest(path: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
  fetchCalls.push({ path, method, body });

  if (path === `${API}/network` && method === "GET") {
    if (networkDown) return errorResponse({ status: 500, code: "INTERNAL_ERROR", message: "内部错误" });
    // 每次返回深拷贝，避免测试本地修改响应体影响服务端事实。
    return jsonResponse(200, JSON.parse(JSON.stringify(net)));
  }
  if (path === `${API}/network/share-listener` && method === "PUT") {
    if (forcedErrors.enable) return errorResponse(forcedErrors.enable);
    const host = String(body?.host);
    const port = Number(body?.port);
    net = networkWith({ enabled: true, running: true, host, port, shareBaseUrl: `http://${host}:${port}` });
    return jsonResponse(200, JSON.parse(JSON.stringify(net)));
  }
  if (path === `${API}/network/share-listener` && method === "DELETE") {
    net = networkWith();
    return new Response(null, { status: 204 });
  }
  if (path === `${API}/members` && method === "GET") {
    return jsonResponse(200, { items: members });
  }

  const rotateMatch = path.match(/^\/api\/v1\/admin\/members\/([^/]+)\/share-link\/rotate$/);
  if (rotateMatch && method === "POST") {
    if (forcedErrors.rotate) return errorResponse(forcedErrors.rotate);
    const member = members.find((item) => item.id === rotateMatch[1]);
    if (!member) return errorResponse({ status: 404, code: "NOT_FOUND", message: "成员不存在" });
    const url = issueUrl(member.id);
    member.shareLink = activeLink({ createdAt: new Date().toISOString() });
    return jsonResponse(200, { id: `link-${member.id}`, status: "active", url, createdAt: member.shareLink.createdAt });
  }

  const memberMatch = path.match(/^\/api\/v1\/admin\/members\/([^/]+)$/);
  if (memberMatch && method === "DELETE") {
    const member = members.find((item) => item.id === memberMatch[1]);
    if (!member) return errorResponse({ status: 404, code: "NOT_FOUND", message: "成员不存在" });
    member.archivedAt = new Date().toISOString();
    member.shareLink = revokedLink({ revokedAt: new Date().toISOString() });
    return new Response(null, { status: 204 });
  }

  const linkMatch = path.match(/^\/api\/v1\/admin\/members\/([^/]+)\/share-link$/);
  if (linkMatch) {
    const member = members.find((item) => item.id === linkMatch[1]);
    if (!member) return errorResponse({ status: 404, code: "NOT_FOUND", message: "成员不存在" });
    if (method === "GET") {
      const link = shareLinkOverrides[member.id] !== undefined ? shareLinkOverrides[member.id]! : member.shareLink;
      return jsonResponse(
        200,
        link
          ? { status: link.status, createdAt: link.createdAt, revokedAt: link.revokedAt, lastUsedAt: link.lastUsedAt }
          : { status: "none" },
      );
    }
    if (method === "POST") {
      if (forcedErrors.generate) return errorResponse(forcedErrors.generate);
      if (member.shareLink?.status === "active") {
        return errorResponse({ status: 409, code: "ACTIVE_SHARE_LINK_EXISTS", message: "已有有效链接" });
      }
      const url = issueUrl(member.id);
      member.shareLink = activeLink({ createdAt: new Date().toISOString() });
      return jsonResponse(201, { id: `link-${member.id}`, status: "active", url, createdAt: member.shareLink.createdAt });
    }
    if (method === "DELETE") {
      member.shareLink = revokedLink({ revokedAt: new Date().toISOString() });
      return new Response(null, { status: 204 });
    }
  }

  return jsonResponse(404, { error: { code: "NOT_FOUND", message: "未知端点", requestId: "r-test" } });
}

function installServer(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return handleRequest(new URL(url).pathname, init);
  }) as typeof fetch;
}

beforeEach(() => {
  net = networkWith();
  members = [makeMember("m-1", "陈晨")];
  forcedErrors = {};
  shareLinkOverrides = {};
  networkDown = false;
  fetchCalls = [];
  issuedCount = 0;
  localStorage.clear();
  clearToasts();
  installServer();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(navigator, "clipboard");
  localStorage.clear();
  clearToasts();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountApp(path = "/members") {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, {
    global: { plugins: [router, [VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
    attachTo: document.body,
  });
  await nextTick();
  return { wrapper, router };
}

/** 取按钮的辅助函数：按可见文案定位，避免依赖 DOM 顺序。 */
function button(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const found = wrapper.findAll("button").find((item) => item.text() === text);
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function openDialog(): HTMLElement {
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null;
  if (!dialog) throw new Error("dialog not open");
  return dialog;
}

/** 取确认 Dialog 内的按钮（teleport 到 body，不在 wrapper 内）。 */
function dialogButton(selector: string): HTMLButtonElement {
  const element = openDialog().querySelector(selector) as HTMLButtonElement | null;
  if (!element) throw new Error(`dialog button not found: ${selector}`);
  return element;
}

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

function linkCalls(): FetchCall[] {
  return fetchCalls.filter((call) => call.path.endsWith("/share-link") || call.path.endsWith("/share-link/rotate"));
}

describe("分享链接单元格（原型 .link-cell，08 §5）", () => {
  it("三态渲染：未生成 / 已生成（含最近使用）/ 已吊销，按钮按状态出现", async () => {
    members = [
      makeMember("m-a", "陈晨", activeLink({ lastUsedAt: "2026-11-01T06:05:00.000Z" })),
      makeMember("m-b", "林悦", activeLink()),
      makeMember("m-c", "王砚", revokedLink()),
      makeMember("m-d", "赵敏"),
    ];
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("陈晨"));

    const rows = wrapper.findAll("tbody tr");
    expect(rows).toHaveLength(4);

    const active = rows[0]!.text();
    expect(active).toContain("已生成");
    expect(active).toMatch(/最近使用 \d{2}-\d{2} \d{2}:\d{2}/);
    expect(active).toContain("重置");
    expect(active).toContain("吊销");
    // D10 裁决后的形态：完整链接不常驻 DOM，行内「复制」入口常驻（仅在本次会话生成后可点）。
    expect(active).toContain("复制");
    expect(active).not.toContain("未生成");

    expect(rows[1]!.text()).toContain("尚未使用");

    const revoked = rows[2]!.text();
    expect(revoked).toContain("已吊销");
    expect(revoked).toContain("重新生成");
    expect(revoked).not.toContain("重置");

    const none = rows[3]!.text();
    expect(none).toContain("未生成");
    expect(none).toContain("生成链接");
    wrapper.unmount();
  });

  it("生成成功 → 完整 URL + 复制 + 分发警告；刷新（只剩 active 态）后不可复制旧链接", async () => {
    lanRunning();
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("未生成"));

    await button(wrapper, "生成链接").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".link-result").exists()).toBe(true));

    const issuedUrl = wrapper.find(".link-result .link-url").text();
    expect(issuedUrl).toMatch(/^http:\/\/192\.168\.1\.5:8123\/#\/s\/[A-Za-z0-9_-]{43}$/);
    expect(wrapper.find(".link-result").text()).toContain("复制");
    expect(wrapper.text()).toContain("链接包含访问凭证，请只发给该成员");
    expect(wrapper.text()).toContain("只能重置");
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();

    await wrapper.find(".link-copy").trigger("click");
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(issuedUrl));
    await vi.waitFor(() => expect(document.body.textContent).toContain("链接已复制"));

    // 复制失败必须提示失败，且 URL 仍是可选中文本，不假装成功。
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    await wrapper.find(".link-copy").trigger("click");
    await vi.waitFor(() => expect(document.body.textContent).toContain("复制失败"));
    expect(wrapper.find(".link-result .link-url").text()).toBe(issuedUrl);
    wrapper.unmount();

    // 模拟刷新：服务端只返回 active 脱敏态，raw URL 不可恢复。
    const second = await mountApp();
    await vi.waitFor(() => expect(second.wrapper.text()).toContain("已生成"));
    expect(second.wrapper.find(".link-result").exists()).toBe(false);
    expect(second.wrapper.find(".link-copy").exists()).toBe(false);
    // D10 裁决后：刷新后行内「复制」仍在但不可点（完整链接不常驻 DOM）。
    const reissueCopies = second.wrapper.findAll("button").filter((item) => item.text() === "复制");
    expect(reissueCopies.length).toBeGreaterThan(0);
    for (const copyBtn of reissueCopies) expect(copyBtn.attributes("disabled")).toBeDefined();
    expect(second.wrapper.text()).not.toContain(issuedUrl);
    second.wrapper.unmount();
  });

  it("重置/吊销：确认 Dialog 的取消不请求，确认走 POST rotate / DELETE 并清掉旧 URL", async () => {
    members = [makeMember("m-a", "陈晨", activeLink())];
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("已生成"));

    await button(wrapper, "重置").trigger("click");
    await nextTick();
    expect(openDialog().textContent).toContain("旧链接将立即失效");
    expect(openDialog().textContent).toContain("重新分发");
    dialogButton(".btn.ghost").click();
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(linkCalls()).toHaveLength(0);

    await button(wrapper, "重置").trigger("click");
    await nextTick();
    dialogButton(".btn.primary").click();
    await vi.waitFor(() => expect(linkCalls().some((call) => call.method === "POST" && call.path.endsWith("/rotate"))).toBe(true));
    await vi.waitFor(() => expect(wrapper.find(".link-result").exists()).toBe(true));
    const rotatedUrl = wrapper.find(".link-result .link-url").text();

    await button(wrapper, "吊销").trigger("click");
    await nextTick();
    expect(openDialog().textContent).toContain("无法再访问");
    expect(openDialog().textContent).toContain("随时重新生成");
    dialogButton(".btn.danger-btn").click();
    await vi.waitFor(() => expect(linkCalls().some((call) => call.method === "DELETE")).toBe(true));
    await vi.waitFor(() => expect(wrapper.text()).toContain("已吊销"));
    expect(wrapper.find(".link-result").exists()).toBe(false);
    expect(wrapper.text()).not.toContain(rotatedUrl);
    wrapper.unmount();
  });

  it("LAN_SHARE_DISABLED（服务端 409 兜底）：提示先开启分享并把焦点交给网络面板", async () => {
    lanRunning();
    forcedErrors.generate = { status: 409, code: "LAN_SHARE_DISABLED", message: "局域网分享未开启" };
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("生成链接"));

    await button(wrapper, "生成链接").trigger("click");
    await vi.waitFor(() => expect(document.body.textContent).toContain("请先开启局域网分享"));

    const panel = wrapper.find(".network-panel");
    expect(panel.exists()).toBe(true);
    await vi.waitFor(() => expect(panel.classes()).toContain("attention"));
    expect(panel.element.contains(document.activeElement)).toBe(true);
    expect(wrapper.find(".link-result").exists()).toBe(false);
    wrapper.unmount();
  });

  it("ACTIVE_SHARE_LINK_EXISTS：提示改用重置，并用 GET share-link 纠正过期行状态", async () => {
    // 列表过期：行内显示未生成，但服务端已有 active 链接。
    members = [makeMember("m-a", "陈晨")];
    shareLinkOverrides["m-a"] = activeLink();
    lanRunning();
    forcedErrors.generate = { status: 409, code: "ACTIVE_SHARE_LINK_EXISTS", message: "已有有效链接" };
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("生成链接"));

    await button(wrapper, "生成链接").trigger("click");
    await vi.waitFor(() => expect(document.body.textContent).toContain("请改用「重置」"));
    await vi.waitFor(() =>
      expect(fetchCalls.some((call) => call.method === "GET" && call.path.endsWith("/share-link"))).toBe(true),
    );
    // GET 纠正后该行不再是「未生成」，而是可重置的 active 态。
    await vi.waitFor(() => expect(wrapper.text()).toContain("已生成"));
    expect(wrapper.text()).not.toContain("生成链接");
    wrapper.unmount();
  });

  it("reconcile 只做一次性纠正：随后吊销并刷新，行必须回到「已吊销」", async () => {
    members = [makeMember("m-1", "陈晨")];
    shareLinkOverrides["m-1"] = activeLink();
    forcedErrors.generate = { status: 409, code: "ACTIVE_SHARE_LINK_EXISTS", message: "已有有效链接" };
    lanRunning();
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("生成链接"));

    await button(wrapper, "生成链接").trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("已生成"));

    await button(wrapper, "吊销").trigger("click");
    await nextTick();
    dialogButton(".btn.danger-btn").click();
    await vi.waitFor(() => expect(wrapper.text()).toContain("已吊销"));
    expect(wrapper.text()).not.toContain("尚未使用");
    wrapper.unmount();
  });

  it("LAN 未运行：点生成不发 POST，直接提示并聚焦网络面板（08 §5 先引导再生成）", async () => {
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("生成链接"));

    await button(wrapper, "生成链接").trigger("click");
    await vi.waitFor(() => expect(document.body.textContent).toContain("请先开启局域网分享"));
    expect(linkCalls()).toHaveLength(0);
    await vi.waitFor(() => expect(wrapper.find(".network-panel").classes()).toContain("attention"));
    expect(wrapper.find(".link-result").exists()).toBe(false);
    wrapper.unmount();
  });

  it("受控结果区按成员对齐：给 B 生成后，A 行复制禁用、B 行复制可用", async () => {
    members = [makeMember("m-a", "陈晨"), makeMember("m-b", "林悦")];
    lanRunning();
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("陈晨"));

    const copyButton = (row: DOMWrapper<Element>) =>
      row.findAll("button").find((item) => item.text() === "复制");

    await button(wrapper, "生成链接").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".link-result").text()).toContain("陈晨"));

    // D10：结果区属于 A，A 行的复制可点；B 仍是未生成。
    let rows = wrapper.findAll("tbody tr");
    expect(copyButton(rows[0]!)?.attributes("disabled")).toBeUndefined();
    expect(rows[1]!.text()).toContain("生成链接");

    await button(wrapper, "生成链接").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".link-result").text()).toContain("林悦"));

    rows = wrapper.findAll("tbody tr");
    // 结果区现在展示 B：A 的复制入口必须禁用，而不是假装可复制。
    expect(copyButton(rows[0]!)?.attributes("disabled")).toBeDefined();
    expect(copyButton(rows[1]!)?.attributes("disabled")).toBeUndefined();
    expect(wrapper.find(".link-result").text()).not.toContain("陈晨");
    wrapper.unmount();
  });

  it("归档成员：确认后清掉该成员的受控结果区，并提示链接立即失效", async () => {
    lanRunning();
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("未生成"));

    await button(wrapper, "生成链接").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".link-result").exists()).toBe(true));

    await button(wrapper, "移除").trigger("click");
    await nextTick();
    expect(openDialog().textContent).toContain("分享链接会立即失效");
    dialogButton(".btn.danger-btn").click();
    await vi.waitFor(() => expect(wrapper.find(".link-result").exists()).toBe(false));
    expect(fetchCalls.some((call) => call.method === "DELETE" && call.path === `${API}/members/m-1`)).toBe(true);
    wrapper.unmount();
  });
});

describe("NetworkSharePanel（08 §5、05 §4.9）", () => {
  it("开启分享：选网卡 + 端口 → PUT 请求体正确，状态变 running 并展示 shareBaseUrl", async () => {
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.find(".network-panel .net-enable").exists()).toBe(true));

    const select = wrapper.find(".network-panel select.net-iface");
    expect((select.element as HTMLSelectElement).value).toBe("192.168.1.5");
    await select.setValue("10.0.0.8");
    await wrapper.find(".network-panel input.net-port").setValue("9000");
    await wrapper.find(".network-panel .net-enable").trigger("click");

    await vi.waitFor(() => {
      const put = fetchCalls.find(
        (call) => call.path === `${API}/network/share-listener` && call.method === "PUT",
      );
      expect(put?.body).toEqual({ host: "10.0.0.8", port: 9000 });
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain("分享中 · 10.0.0.8:9000"));
    expect(wrapper.find(".network-panel .net-base-url").text()).toBe("http://10.0.0.8:9000");

    // 开启成功同步失效 network + members（shareBaseUrl 影响链接展示）。
    const memberFetches = fetchCalls.filter((call) => call.path === `${API}/members` && call.method === "GET");
    expect(memberFetches.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it("默认端口跟随 loopback 实际端口：--port 9000 时开启表单预填 9000", async () => {
    net = networkWith();
    net.loopbackUrl = "http://127.0.0.1:9000";
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.find(".network-panel .net-enable").exists()).toBe(true));
    expect((wrapper.find(".network-panel input.net-port").element as HTMLInputElement).value).toBe("9000");
    wrapper.unmount();
  });

  it("切换地址：确认后 PUT 新网卡并提示旧 URL 需要重新分发", async () => {
    net = networkWith({ enabled: true, running: true, host: "192.168.1.5", port: 8123, shareBaseUrl: "http://192.168.1.5:8123" });
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("切换地址"));

    await wrapper.find(".network-panel .net-switch").trigger("click");
    await nextTick();
    expect(wrapper.find(".network-panel .net-switch-form").exists()).toBe(true);
    await wrapper.find(".network-panel .net-switch-form select.net-iface").setValue("10.0.0.8");
    await wrapper.find(".network-panel .net-apply").trigger("click");

    await vi.waitFor(() => {
      const put = fetchCalls.find(
        (call) => call.path === `${API}/network/share-listener` && call.method === "PUT",
      );
      expect(put?.body).toEqual({ host: "10.0.0.8", port: 8123 });
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain("旧 URL 需要重新分发"));
    await vi.waitFor(() => expect(wrapper.find(".network-panel .net-base-url").text()).toBe("http://10.0.0.8:8123"));
    wrapper.unmount();
  });

  it("关闭分享：确认 Dialog 取消不发请求，确认后 DELETE 并回到仅本机", async () => {
    net = networkWith({ enabled: true, running: true, host: "192.168.1.5", port: 8123, shareBaseUrl: "http://192.168.1.5:8123" });
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("关闭分享"));

    await wrapper.find(".network-panel .net-close").trigger("click");
    await nextTick();
    expect(openDialog().textContent).toContain("不会吊销");
    expect(openDialog().textContent).toContain("旧链接");
    dialogButton(".btn.ghost").click();
    await nextTick();
    expect(fetchCalls.some((call) => call.method === "DELETE")).toBe(false);

    await wrapper.find(".network-panel .net-close").trigger("click");
    await nextTick();
    dialogButton(".net-confirm-close").click();
    await vi.waitFor(() =>
      expect(
        fetchCalls.some((call) => call.path === `${API}/network/share-listener` && call.method === "DELETE"),
      ).toBe(true),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain("已关闭 · 仅本机可用"));
    expect(wrapper.find(".network-panel .net-base-url").exists()).toBe(false);
    wrapper.unmount();
  });

  it("422 LAN_INTERFACE_INVALID：toast 提示且保留原状态，不假装已开启", async () => {
    forcedErrors.enable = { status: 422, code: "LAN_INTERFACE_INVALID", message: "网卡地址不可用" };
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.find(".network-panel .net-enable").exists()).toBe(true));

    await wrapper.find(".network-panel .net-enable").trigger("click");
    await vi.waitFor(() => expect(document.body.textContent).toContain("网卡地址不可用，请重新选择"));

    expect(wrapper.text()).toContain("已关闭 · 仅本机可用");
    expect(wrapper.text()).not.toContain("分享中");
    expect(wrapper.find(".network-panel .net-base-url").exists()).toBe(false);
    // 表单仍在，允许重试选择地址。
    expect(wrapper.find(".network-panel .net-enable").exists()).toBe(true);
    wrapper.unmount();
  });

  it("degraded：异常 chip、脱敏错误与「重新选择地址」", async () => {
    // 服务端语义：degraded 表示期望开启但本次 bind 失败，running 必为 false、shareBaseUrl=null。
    net = networkWith({
      enabled: true,
      running: false,
      degraded: true,
      host: "192.168.1.5",
      port: 8123,
      shareBaseUrl: null,
      error: "bind 失败 /Users/secret/network.json",
    });
    const { wrapper } = await mountApp();
    await vi.waitFor(() => expect(wrapper.text()).toContain("分享异常"));
    await vi.waitFor(() => expect(wrapper.find(".network-panel .net-enable").text()).toContain("重新选择地址"));
    // 保留上次选择的网卡，便于重试。
    expect((wrapper.find(".network-panel select.net-iface").element as HTMLSelectElement).value).toBe("192.168.1.5");
    expect(wrapper.text()).not.toContain("/Users/secret");
    wrapper.unmount();
  });
});

describe("AdminLayout LAN 状态 chip（08 §5、02 F1）", () => {
  it("三态：running → LAN · host:port；degraded → 分享异常；未开启 → 仅本机，入口指向成员页", async () => {
    const off = await mountApp("/members");
    await vi.waitFor(() => expect(off.wrapper.find(".appbar .lan-chip").text()).toBe("仅本机"));
    expect(off.wrapper.find(".appbar .lan-chip").attributes("href")).toBe("#/members");
    off.wrapper.unmount();

    net = networkWith({ enabled: true, running: true, host: "192.168.1.5", port: 8123, shareBaseUrl: "http://192.168.1.5:8123" });
    const up = await mountApp("/members");
    await vi.waitFor(() => expect(up.wrapper.find(".appbar .lan-chip").text()).toBe("LAN · 192.168.1.5:8123"));
    expect(up.wrapper.find(".appbar .lan-chip").classes()).toContain("up");
    up.wrapper.unmount();

    net = networkWith({ enabled: true, degraded: true, error: "监听异常 /Users/secret/network.json" });
    const warn = await mountApp("/members");
    await vi.waitFor(() => expect(warn.wrapper.find(".appbar .lan-chip").text()).toBe("分享异常"));
    expect(warn.wrapper.find(".appbar .lan-chip").classes()).toContain("warn");
    expect(warn.wrapper.find(".appbar .lan-chip").attributes("title")).not.toContain("/Users/secret");
    warn.wrapper.unmount();
  });

  it("服务不可达：显示明确故障态而不是「仅本机」", async () => {
    networkDown = true;
    const { wrapper } = await mountApp("/members");
    await vi.waitFor(
      () => expect(wrapper.find(".appbar .lan-chip").text()).toBe("服务不可达"),
      { timeout: 8_000 },
    );
    expect(wrapper.find(".appbar .lan-chip").classes()).toContain("down");
    wrapper.unmount();
  });
});
