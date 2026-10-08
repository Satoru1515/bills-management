import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVICE_WORKER_URL, registerServiceWorker } from "./register";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerServiceWorker", () => {
  it("registers /sw.js for the whole site in production", async () => {
    const registration = { scope: "/" } as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    await expect(registerServiceWorker({ serviceWorker: { register } }, true)).resolves.toBe(
      registration,
    );
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, {
      scope: "/",
      updateViaCache: "none",
    });
    expect(SERVICE_WORKER_URL).toBe("/sw.js");
  });

  it("does nothing outside production builds", async () => {
    const register = vi.fn();
    await expect(registerServiceWorker({ serviceWorker: { register } }, false)).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("is off by default under the test runner (NODE_ENV is not production)", async () => {
    const register = vi.fn();
    await expect(registerServiceWorker({ serviceWorker: { register } })).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("does nothing when the browser has no service workers", async () => {
    await expect(registerServiceWorker({}, true)).resolves.toBeNull();
    await expect(registerServiceWorker(undefined, true)).resolves.toBeNull();
  });

  it("swallows registration errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const register = vi.fn().mockRejectedValue(new Error("insecure origin"));
    await expect(registerServiceWorker({ serviceWorker: { register } }, true)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
