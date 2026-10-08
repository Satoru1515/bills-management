// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Runs the real public/sw.js against an in-memory Cache Storage and a fake network. */

const ORIGIN = "https://bills.test";
const source = readFileSync(join(__dirname, "..", "..", "..", "public", "sw.js"), "utf8");

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

class FakeResponse {
  constructor(
    readonly body: string,
    readonly status = 200,
    readonly type: "basic" | "cors" | "opaque" = "basic",
  ) {}
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  clone() {
    return new FakeResponse(this.body, this.status, this.type);
  }
}

type RequestLike = FakeRequest | string;
const keyOf = (request: RequestLike) =>
  new URL(typeof request === "string" ? request : request.url, ORIGIN).href;

class FakeCache {
  readonly entries = new Map<string, FakeResponse>();
  constructor(private readonly network: (request: RequestLike) => Promise<FakeResponse>) {}
  async match(request: RequestLike) {
    return this.entries.get(keyOf(request));
  }
  async put(request: RequestLike, response: FakeResponse) {
    this.entries.delete(keyOf(request));
    this.entries.set(keyOf(request), response);
  }
  async addAll(urls: string[]) {
    for (const url of urls) {
      const response = await this.network(url);
      if (!response.ok) throw new TypeError(`addAll: ${url} answered ${response.status}`);
      await this.put(url, response);
    }
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(request: RequestLike) {
    return this.entries.delete(keyOf(request));
  }
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  constructor(private readonly network: (request: RequestLike) => Promise<FakeResponse>) {}
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.network));
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(request: RequestLike) {
    for (const cache of this.stores.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

interface WorkerEvent {
  request?: FakeRequest;
  waitUntil(promise: Promise<unknown>): void;
  respondWith(promise: Promise<unknown>): void;
}

let online: boolean;
let served: Map<string, FakeResponse>;
let network: ReturnType<typeof vi.fn<(request: RequestLike) => Promise<FakeResponse>>>;
let caches: FakeCacheStorage;
let handlers: Map<string, (event: WorkerEvent) => void>;
let self: {
  location: { origin: string };
  addEventListener: (type: string, handler: (event: WorkerEvent) => void) => void;
  skipWaiting: ReturnType<typeof vi.fn>;
  clients: { claim: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  online = true;
  served = new Map([
    ["/offline.html", new FakeResponse("offline page")],
    ["/icons/icon-192.png", new FakeResponse("icon 192")],
    ["/icons/icon-512.png", new FakeResponse("icon 512")],
    ["/icons/maskable-512.png", new FakeResponse("maskable 512")],
  ]);
  network = vi.fn(async (request: RequestLike) => {
    if (!online) throw new TypeError("Failed to fetch");
    const url = new URL(keyOf(request));
    return served.get(url.pathname)?.clone() ?? new FakeResponse("not found", 404);
  });
  caches = new FakeCacheStorage(network);
  handlers = new Map();
  self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  new Function("self", "caches", "fetch", "Response", source)(self, caches, network, Response);
});

async function lifecycle(type: "install" | "activate") {
  const pending: Promise<unknown>[] = [];
  handlers.get(type)!({
    waitUntil: (promise) => pending.push(promise),
    respondWith: () => {
      throw new Error("not a fetch event");
    },
  });
  await Promise.all(pending);
}

/** Dispatches a fetch event; undefined when the worker leaves it to the browser. */
async function request(path: string, init: Partial<FakeRequest> = {}) {
  let response: Promise<unknown> | undefined;
  const pending: Promise<unknown>[] = [];
  handlers.get("fetch")!({
    request: { url: new URL(path, ORIGIN).href, method: "GET", mode: "cors", ...init },
    waitUntil: (promise) => pending.push(promise),
    respondWith: (promise) => {
      response = promise;
    },
  });
  if (!response) return undefined;
  const result = (await response) as FakeResponse | Response;
  await Promise.all(pending);
  return result;
}

async function staticCache() {
  const names = await caches.keys();
  expect(names).toHaveLength(1);
  return caches.open(names[0]);
}

describe("service worker", () => {
  it("caches the offline page and icons on install and takes over at once", async () => {
    await lifecycle("install");
    const cache = await staticCache();
    expect([...cache.entries.keys()]).toEqual([
      `${ORIGIN}/offline.html`,
      `${ORIGIN}/icons/icon-192.png`,
      `${ORIGIN}/icons/icon-512.png`,
      `${ORIGIN}/icons/maskable-512.png`,
    ]);
    expect(self.skipWaiting).toHaveBeenCalledOnce();
  });

  it("deletes the caches of older versions on activate, and nobody else's", async () => {
    await lifecycle("install");
    await caches.open("bills-static-v0");
    await caches.open("someone-elses-cache");
    await lifecycle("activate");
    const names = await caches.keys();
    expect(names).toContain("someone-elses-cache");
    expect(names.filter((name) => name.startsWith("bills-"))).toHaveLength(1);
    expect(names).not.toContain("bills-static-v0");
    expect(self.clients.claim).toHaveBeenCalledOnce();
  });

  it("serves build assets from the cache after the first load", async () => {
    served.set("/_next/static/chunks/app.js", new FakeResponse("chunk"));
    const first = await request("/_next/static/chunks/app.js");
    expect(first).toMatchObject({ body: "chunk" });
    online = false;
    const second = await request("/_next/static/chunks/app.js");
    expect(second).toMatchObject({ body: "chunk" });
    expect(network).toHaveBeenCalledOnce();
  });

  it("does not cache failed or cross-origin-typed asset responses", async () => {
    await request("/_next/static/chunks/missing.js");
    served.set("/_next/static/chunks/odd.js", new FakeResponse("odd", 200, "opaque"));
    await request("/_next/static/chunks/odd.js");
    expect(await caches.match("/_next/static/chunks/missing.js")).toBeUndefined();
    expect(await caches.match("/_next/static/chunks/odd.js")).toBeUndefined();
  });

  it("keeps only the newest 200 build assets", async () => {
    for (let i = 0; i < 205; i++) {
      served.set(`/_next/static/chunks/${i}.js`, new FakeResponse(`chunk ${i}`));
      await request(`/_next/static/chunks/${i}.js`);
    }
    const cache = await staticCache();
    expect(cache.entries.size).toBe(200);
    expect(await cache.match("/_next/static/chunks/4.js")).toBeUndefined();
    expect(await cache.match("/_next/static/chunks/5.js")).toBeDefined();
    expect(await cache.match("/_next/static/chunks/204.js")).toBeDefined();
  });

  it("answers icons from the cache and refreshes them in the background", async () => {
    await lifecycle("install");
    served.set("/icons/icon-192.png", new FakeResponse("new icon 192"));
    const response = await request("/icons/icon-192.png");
    expect(response).toMatchObject({ body: "icon 192" });
    const cache = await staticCache();
    expect(await cache.match("/icons/icon-192.png")).toMatchObject({ body: "new icon 192" });
  });

  it("serves a cached icon while offline", async () => {
    await lifecycle("install");
    online = false;
    expect(await request("/icons/icon-512.png")).toMatchObject({ body: "icon 512" });
  });

  it("caches the manifest once fetched", async () => {
    served.set("/manifest.webmanifest", new FakeResponse("{}"));
    expect(await request("/manifest.webmanifest")).toMatchObject({ body: "{}" });
    online = false;
    expect(await request("/manifest.webmanifest")).toMatchObject({ body: "{}" });
  });

  it("loads pages from the network and never caches them", async () => {
    await lifecycle("install");
    served.set("/app", new FakeResponse("dashboard with private data"));
    const response = await request("/app?month=2026-10", { mode: "navigate" });
    expect(response).toMatchObject({ body: "dashboard with private data" });
    expect(await caches.match("/app?month=2026-10")).toBeUndefined();
    expect(await caches.match("/app")).toBeUndefined();
  });

  it("passes the server's error pages through while online", async () => {
    const response = await request("/nowhere", { mode: "navigate" });
    expect(response).toMatchObject({ status: 404 });
  });

  it("shows the offline page when a page cannot be reached", async () => {
    await lifecycle("install");
    online = false;
    expect(await request("/app/settings", { mode: "navigate" })).toMatchObject({
      body: "offline page",
    });
  });

  it("answers 503 when offline before the offline page was cached", async () => {
    online = false;
    const response = (await request("/app", { mode: "navigate" })) as Response;
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(503);
  });

  it.each([
    ["an API call", "/api/sync", {}],
    ["a sync POST", "/api/sync", { method: "POST" }],
    ["a server action", "/app", { method: "POST" }],
    ["page data (React Server Components)", "/app?_rsc=1x2y3", {}],
    ["the auth callback", "/auth/callback?code=abc", {}],
    ["another site", "https://fonts.example.com/a.woff2", {}],
    ["another site's page", "https://accounts.google.com/o/oauth2", { mode: "navigate" }],
  ])("leaves %s to the browser", async (_, path, init) => {
    expect(await request(path, init)).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  });
});
