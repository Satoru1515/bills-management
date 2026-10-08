import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: true,
  listeners: [] as Array<(event: { url: string }) => void>,
  remove: vi.fn(async () => {}),
  launchUrl: undefined as string | undefined,
  close: vi.fn(async () => {}),
  finish: vi.fn(async () => "/app"),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_event: string, listener: (event: { url: string }) => void) => {
      mocks.listeners.push(listener);
      return { remove: mocks.remove };
    }),
    getLaunchUrl: vi.fn(async () => (mocks.launchUrl ? { url: mocks.launchUrl } : undefined)),
  },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { close: mocks.close } }));
vi.mock("@/app/login/actions", () => ({ finishNativeGoogleSignInAction: mocks.finish }));

import { App } from "@capacitor/app";
import { NativeAuthListener } from "./native-auth-listener";

const navigate = vi.fn();
const LINK = "com.satoru1515.bills://auth/callback?code=abc";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.native = true;
  mocks.listeners = [];
  mocks.launchUrl = undefined;
});

describe("NativeAuthListener", () => {
  it("does nothing on the web", async () => {
    mocks.native = false;
    render(<NativeAuthListener navigate={navigate} />);
    await Promise.resolve();
    expect(App.addListener).not.toHaveBeenCalled();
    expect(App.getLaunchUrl).not.toHaveBeenCalled();
  });

  it("finishes sign-in when the deep link opens the app", async () => {
    sessionStorage.setItem("bills:native-sign-in-next", "/app/settings");
    mocks.finish.mockResolvedValueOnce("/app/settings");
    render(<NativeAuthListener navigate={navigate} />);
    await waitFor(() => expect(mocks.listeners).toHaveLength(1));

    mocks.listeners[0]({ url: LINK });

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/settings"));
    expect(mocks.finish).toHaveBeenCalledWith({ code: "abc", error: null }, "/app/settings");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("finishes sign-in from the link that launched the app, once", async () => {
    mocks.launchUrl = LINK;
    const { unmount } = render(<NativeAuthListener navigate={navigate} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app"));
    unmount();

    // The next page load sees the same launch link again.
    render(<NativeAuthListener navigate={navigate} />);
    await waitFor(() => expect(App.getLaunchUrl).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(mocks.finish).toHaveBeenCalledOnce();
  });

  it("ignores other deep links", async () => {
    render(<NativeAuthListener navigate={navigate} />);
    await waitFor(() => expect(mocks.listeners).toHaveLength(1));
    mocks.listeners[0]({ url: "com.satoru1515.bills://somewhere" });
    await Promise.resolve();
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("removes its listener when unmounted", async () => {
    const { unmount } = render(<NativeAuthListener navigate={navigate} />);
    await waitFor(() => expect(mocks.listeners).toHaveLength(1));
    unmount();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
