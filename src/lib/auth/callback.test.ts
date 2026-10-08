import { describe, expect, it, vi } from "vitest";
import { handleAuthCallback, type CallbackDeps } from "./callback";
import type { ProviderSession } from "./gmail-token";

const SESSION: ProviderSession = {
  provider_refresh_token: "1//0test-refresh-token",
  user: { id: "11111111-1111-4111-8111-111111111111", email: "satoru@example.com" },
};

function deps(overrides: Partial<CallbackDeps> = {}) {
  return {
    exchangeCode: vi.fn<CallbackDeps["exchangeCode"]>(async () => ({
      session: SESSION,
      error: null,
    })),
    storeToken: vi.fn<CallbackDeps["storeToken"]>(async () => "stored" as const),
    log: vi.fn<(message: string) => void>(),
    ...overrides,
  };
}

async function run(url: string, d = deps()) {
  return (await handleAuthCallback(new URL(url), d)).toString();
}

describe("handleAuthCallback", () => {
  it("exchanges the code, stores the token and goes to /app", async () => {
    const d = deps();
    await expect(run("http://localhost:3000/auth/callback?code=abc", d)).resolves.toBe(
      "http://localhost:3000/app",
    );
    expect(d.exchangeCode).toHaveBeenCalledWith("abc");
    expect(d.storeToken).toHaveBeenCalledWith(SESSION);
    expect(d.log).not.toHaveBeenCalled();
  });

  it("returns to the requested page", async () => {
    await expect(
      run("http://localhost:3000/auth/callback?code=abc&next=%2Fapp%2Fsettings"),
    ).resolves.toBe("http://localhost:3000/app/settings");
  });

  it("ignores a next that points to another site", async () => {
    await expect(
      run("http://localhost:3000/auth/callback?code=abc&next=https%3A%2F%2Fevil.com"),
    ).resolves.toBe("http://localhost:3000/app");
    await expect(
      run("http://localhost:3000/auth/callback?code=abc&next=%2F%2Fevil.com"),
    ).resolves.toBe("http://localhost:3000/app");
  });

  it("reports a refused consent", async () => {
    const d = deps();
    await expect(
      run("http://localhost:3000/auth/callback?error=access_denied&error_description=denied", d),
    ).resolves.toBe("http://localhost:3000/login?error=access_denied");
    expect(d.exchangeCode).not.toHaveBeenCalled();
  });

  it("reports other provider errors as a failed exchange", async () => {
    await expect(
      run("http://localhost:3000/auth/callback?error=server_error&next=%2Fapp%2Fx"),
    ).resolves.toBe("http://localhost:3000/login?next=%2Fapp%2Fx&error=exchange_failed");
  });

  it("requires a code", async () => {
    const d = deps();
    await expect(run("http://localhost:3000/auth/callback", d)).resolves.toBe(
      "http://localhost:3000/login?error=missing_code",
    );
    expect(d.exchangeCode).not.toHaveBeenCalled();
  });

  it("fails when the code cannot be exchanged", async () => {
    const d = deps({
      exchangeCode: vi.fn(async () => ({ session: null, error: { message: "invalid grant" } })),
    });
    await expect(run("http://localhost:3000/auth/callback?code=bad", d)).resolves.toBe(
      "http://localhost:3000/login?error=exchange_failed",
    );
    expect(d.storeToken).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("invalid grant"));
  });

  it("fails when there is no session and no error", async () => {
    const d = deps({ exchangeCode: vi.fn(async () => ({ session: null, error: null })) });
    await expect(run("http://localhost:3000/auth/callback?code=abc", d)).resolves.toBe(
      "http://localhost:3000/login?error=exchange_failed",
    );
  });

  it("reports a token that could not be saved", async () => {
    const d = deps({
      storeToken: vi.fn(async () => {
        throw new Error("Missing ENCRYPTION_KEY");
      }),
    });
    await expect(run("http://localhost:3000/auth/callback?code=abc", d)).resolves.toBe(
      "http://localhost:3000/login?error=gmail_token_failed",
    );
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("Missing ENCRYPTION_KEY"));
  });

  it("continues when Google sent no refresh token", async () => {
    const d = deps({ storeToken: vi.fn(async () => "missing" as const) });
    await expect(run("http://localhost:3000/auth/callback?code=abc", d)).resolves.toBe(
      "http://localhost:3000/app",
    );
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("no refresh token"));
  });
});
