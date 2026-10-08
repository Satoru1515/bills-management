import { describe, expect, it, vi } from "vitest";
import {
  APP_URL_SCHEME,
  HANDLED_STORAGE_KEY,
  NATIVE_CALLBACK_URL,
  NEXT_STORAGE_KEY,
  callbackSearchParams,
  createDeepLinkHandler,
  parseNativeCallback,
  rememberNext,
  type DeepLinkHandlerDeps,
  type KeyValueStorage,
} from "./native";

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const brokenStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const LINK = `${NATIVE_CALLBACK_URL}?code=abc-123`;

describe("constants", () => {
  it("uses the app ID as the scheme and carries no query", () => {
    expect(APP_URL_SCHEME).toBe("com.satoru1515.bills");
    expect(NATIVE_CALLBACK_URL).toBe("com.satoru1515.bills://auth/callback");
  });
});

describe("parseNativeCallback", () => {
  it("reads the code", () => {
    expect(parseNativeCallback(LINK)).toEqual({ code: "abc-123", error: null });
  });

  it("reads an error from the query or the fragment", () => {
    expect(parseNativeCallback(`${NATIVE_CALLBACK_URL}?error=access_denied`)).toEqual({
      code: null,
      error: "access_denied",
    });
    expect(
      parseNativeCallback(`${NATIVE_CALLBACK_URL}#error=server_error&error_description=x`),
    ).toEqual({ code: null, error: "server_error" });
  });

  it("accepts a trailing slash and an empty query", () => {
    expect(parseNativeCallback(`${NATIVE_CALLBACK_URL}/?code=x`)).toEqual({
      code: "x",
      error: null,
    });
    expect(parseNativeCallback(NATIVE_CALLBACK_URL)).toEqual({ code: null, error: null });
  });

  it("ignores other deep links and other schemes", () => {
    expect(parseNativeCallback("com.satoru1515.bills://app/settings")).toBeNull();
    expect(parseNativeCallback("com.satoru1515.bills://auth/other?code=x")).toBeNull();
    expect(parseNativeCallback("com.other.app://auth/callback?code=x")).toBeNull();
    expect(parseNativeCallback("https://auth/callback?code=x")).toBeNull();
    expect(parseNativeCallback("not a url")).toBeNull();
    expect(parseNativeCallback("")).toBeNull();
  });
});

describe("callbackSearchParams", () => {
  it("builds the /auth/callback query", () => {
    expect(callbackSearchParams({ code: "abc", error: null }, "/app/settings").toString()).toBe(
      "code=abc&next=%2Fapp%2Fsettings",
    );
    expect(callbackSearchParams({ code: null, error: "access_denied" }, null).toString()).toBe(
      "error=access_denied&next=%2Fapp",
    );
  });

  it("never keeps a next path to another site", () => {
    expect(callbackSearchParams({ code: "abc", error: null }, "//evil.com").get("next")).toBe(
      "/app",
    );
  });
});

describe("rememberNext", () => {
  it("stores a safe path", () => {
    const storage = new MemoryStorage();
    rememberNext(storage, "/app/settings");
    expect(storage.getItem(NEXT_STORAGE_KEY)).toBe("/app/settings");
    rememberNext(storage, "https://evil.com");
    expect(storage.getItem(NEXT_STORAGE_KEY)).toBe("/app");
  });

  it("does not throw without storage", () => {
    expect(() => rememberNext(null, "/app")).not.toThrow();
    expect(() => rememberNext(brokenStorage, "/app")).not.toThrow();
  });
});

describe("createDeepLinkHandler", () => {
  function setup(overrides: Partial<DeepLinkHandlerDeps> = {}) {
    const storage = new MemoryStorage();
    const deps = {
      finish: vi.fn(async (_params: unknown, next: string) => next),
      navigate: vi.fn(),
      closeBrowser: vi.fn(async () => {}),
      storage,
      log: vi.fn(),
      ...overrides,
    };
    return { deps, storage, handle: createDeepLinkHandler(deps) };
  }

  it("finishes sign-in, closes the browser and opens the remembered page", async () => {
    const { deps, storage, handle } = setup();
    rememberNext(storage, "/app/settings");

    await expect(handle(LINK)).resolves.toBe(true);

    expect(deps.closeBrowser).toHaveBeenCalledOnce();
    expect(deps.finish).toHaveBeenCalledWith({ code: "abc-123", error: null }, "/app/settings");
    expect(deps.navigate).toHaveBeenCalledWith("/app/settings");
    expect(storage.getItem(NEXT_STORAGE_KEY)).toBeNull();
  });

  it("opens /app when no page was remembered (the app was restarted)", async () => {
    const { deps, handle } = setup();
    await handle(LINK);
    expect(deps.finish).toHaveBeenCalledWith(expect.anything(), "/app");
  });

  it("opens what the server returns, such as a login error", async () => {
    const { deps, handle } = setup({
      finish: vi.fn(async () => "/login?error=access_denied"),
    });
    await handle(`${NATIVE_CALLBACK_URL}?error=access_denied`);
    expect(deps.navigate).toHaveBeenCalledWith("/login?error=access_denied");
  });

  it("handles each link once", async () => {
    const { deps, storage, handle } = setup();
    await handle(LINK);
    await expect(handle(LINK)).resolves.toBe(false);
    expect(deps.finish).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.getItem(HANDLED_STORAGE_KEY)!)).toEqual([LINK]);

    // A new sign-in brings a new code.
    await expect(handle(`${NATIVE_CALLBACK_URL}?code=def`)).resolves.toBe(true);
    expect(deps.finish).toHaveBeenCalledTimes(2);
  });

  it("handles a link once even when two events arrive together", async () => {
    const { deps, handle } = setup();
    const results = await Promise.all([handle(LINK), handle(LINK)]);
    expect(results.sort()).toEqual([false, true]);
    expect(deps.navigate).toHaveBeenCalledOnce();
  });

  it("keeps only the last few handled links", async () => {
    const { storage, handle } = setup();
    for (let i = 0; i < 8; i++) await handle(`${NATIVE_CALLBACK_URL}?code=${i}`);
    const handled = JSON.parse(storage.getItem(HANDLED_STORAGE_KEY)!) as string[];
    expect(handled).toHaveLength(5);
    expect(handled.at(-1)).toBe(`${NATIVE_CALLBACK_URL}?code=7`);
  });

  it("ignores links that are not the sign-in callback", async () => {
    const { deps, handle } = setup();
    await expect(handle("com.satoru1515.bills://app/settings")).resolves.toBe(false);
    expect(deps.finish).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.closeBrowser).not.toHaveBeenCalled();
  });

  it("still finishes when the browser is already closed", async () => {
    const { deps, handle } = setup({
      closeBrowser: vi.fn(async () => {
        throw new Error("not open");
      }),
    });
    await handle(LINK);
    expect(deps.navigate).toHaveBeenCalledWith("/app");
  });

  it("goes to the login error page when the server call fails", async () => {
    const { deps, handle } = setup({
      finish: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    await handle(LINK);
    expect(deps.log).toHaveBeenCalledWith("native sign-in: network down");
    expect(deps.navigate).toHaveBeenCalledWith("/login?error=exchange_failed");
  });

  it("works without storage, and with storage that throws", async () => {
    for (const storage of [null, brokenStorage]) {
      const { deps, handle } = setup({ storage });
      await expect(handle(LINK)).resolves.toBe(true);
      expect(deps.navigate).toHaveBeenCalledWith("/app");
    }
  });

  it("treats a corrupt handled list as empty", async () => {
    const { deps, storage, handle } = setup();
    storage.setItem(HANDLED_STORAGE_KEY, "{not json");
    await expect(handle(LINK)).resolves.toBe(true);
    storage.setItem(HANDLED_STORAGE_KEY, JSON.stringify({ a: 1 }));
    await expect(handle(`${NATIVE_CALLBACK_URL}?code=z`)).resolves.toBe(true);
    expect(deps.finish).toHaveBeenCalledTimes(2);
  });
});
