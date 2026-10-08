import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: false,
  open: vi.fn(),
  signIn: vi.fn(),
  startNative: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: mocks.open } }));
vi.mock("./actions", () => ({
  signInWithGoogleAction: mocks.signIn,
  startNativeGoogleSignInAction: mocks.startNative,
}));

import { NEXT_STORAGE_KEY } from "@/lib/auth/native";
import { GoogleSignInForm } from "./google-sign-in-form";

function renderForm(next = "/app/settings") {
  render(
    <GoogleSignInForm className="my-form">
      <input type="hidden" name="next" value={next} />
      <button type="submit">Continue with Google</button>
    </GoogleSignInForm>,
  );
  return screen.getByRole("button", { name: "Continue with Google" });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.native = false;
  mocks.signIn.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue(undefined);
  mocks.startNative.mockResolvedValue({ ok: true, url: "https://x.supabase.co/auth/v1/authorize" });
});

describe("GoogleSignInForm", () => {
  it("posts to the server action on the web", async () => {
    fireEvent.click(renderForm());
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledOnce());
    const data = mocks.signIn.mock.calls[0][0] as FormData;
    expect(data.get("next")).toBe("/app/settings");
    expect(mocks.startNative).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(document.querySelector("form")).toHaveClass("my-form");
  });

  it("opens the consent screen in the system browser in the app", async () => {
    mocks.native = true;
    fireEvent.click(renderForm());
    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({ url: "https://x.supabase.co/auth/v1/authorize" }),
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(NEXT_STORAGE_KEY)).toBe("/app/settings");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the error when sign-in cannot start in the app", async () => {
    mocks.native = true;
    mocks.startNative.mockResolvedValue({ ok: false, error: "Google sign-in could not start." });
    fireEvent.click(renderForm());
    expect(await screen.findByRole("alert")).toHaveTextContent("Google sign-in could not start.");
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("shows an error when the browser cannot open", async () => {
    mocks.native = true;
    mocks.open.mockRejectedValue(new Error("no browser"));
    fireEvent.click(renderForm());
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not start/);
  });
});
