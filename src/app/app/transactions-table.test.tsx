import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  updateCategoryAction: vi.fn(),
  setIgnoredAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("./actions", () => ({
  updateCategoryAction: mocks.updateCategoryAction,
  setIgnoredAction: mocks.setIgnoredAction,
}));

import type { Transaction } from "@/lib/domain/types";
import { TransactionsTable } from "./transactions-table";

let nextId = 0;
function tx(overrides: Partial<Transaction>): Transaction {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    userId: "user-1",
    gmailMessageId: `msg-${nextId}`,
    date: "2026-10-04T19:35:00-04:00",
    month: "2026-10",
    bank: "Scotiabank",
    cardLast4: "1234",
    amount: 1500.5,
    currency: "DOP",
    merchant: "SUPERMERCADO BRAVO",
    kind: "consumo",
    category: "Supermercado",
    ignored: false,
    source: "gmail",
    ...overrides,
  };
}

const BRAVO = tx({});
const CAFE = tx({
  date: "2026-10-03T08:10:00-04:00",
  merchant: "Café Santo Domingo",
  category: "Restaurantes",
  bank: "APAP",
  cardLast4: "9876",
  amount: 450,
});
const NETFLIX = tx({
  date: "2026-10-02T12:00:00-04:00",
  merchant: "NETFLIX.COM",
  category: "Suscripciones",
  bank: "PayPal",
  cardLast4: "7782",
  amount: 11.99,
  currency: "USD",
});
const SHELL = tx({
  date: "2026-10-01T21:15:00-04:00",
  merchant: "SHELL NAVARRETE",
  category: "Combustible",
  amount: 2000,
  ignored: true,
});
const MONTH = [BRAVO, CAFE, NETFLIX, SHELL];

function renderTable(
  props: Partial<Parameters<typeof TransactionsTable>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <TransactionsTable
      month="2026-10"
      transactions={MONTH}
      usdToDopRate={63}
      category={null}
      {...props}
    />,
  );
}

function merchants(): string[] {
  const rows = screen.queryAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell")[1].querySelector("span")!.textContent!);
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.updateCategoryAction.mockReset();
  mocks.setIgnoredAction.mockReset();
});

describe("TransactionsTable", () => {
  it("lists the month's purchases with date, card, category and amount", () => {
    renderTable();

    expect(merchants()).toEqual([
      "SUPERMERCADO BRAVO",
      "Café Santo Domingo",
      "NETFLIX.COM",
      "SHELL NAVARRETE",
    ]);
    const bravo = screen.getAllByRole("row")[1];
    expect(bravo).toHaveTextContent("Oct 4");
    expect(bravo).toHaveTextContent("7:35 PM");
    expect(bravo).toHaveTextContent("Scotiabank · card ending in •••• 1234");
    expect(bravo).toHaveTextContent("RD$ 1,500.50");
    expect(screen.getByLabelText("Category of SUPERMERCADO BRAVO")).toHaveValue("Supermercado");
    expect(screen.getAllByRole("row")[3]).toHaveTextContent("US$ 11.99");

    const shell = screen.getAllByRole("row")[4];
    expect(shell).toHaveTextContent("Ignored");
    expect(within(shell).getByRole("button", { name: "Restore SHELL NAVARRETE" })).toBeVisible();
    // 1500.50 + 450 + 11.99 × 63; the ignored 2000 is left out.
    expect(screen.getByText(/^4 purchases · RD\$ 2,705\.87/)).toHaveTextContent(
      "(1 ignored left out)",
    );
  });

  it("searches as you type, ignoring case and accents", () => {
    renderTable();

    fireEvent.change(screen.getByLabelText("Search transactions"), { target: { value: "cafe" } });
    expect(merchants()).toEqual(["Café Santo Domingo"]);
    expect(screen.getByText(/^1 purchase of 4 · RD\$ 450\.00$/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search transactions"), { target: { value: "zzz" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No purchases match these filters.")).toBeInTheDocument();
  });

  it("filters by the banks present this month", () => {
    renderTable();

    const bank = screen.getByLabelText("Bank");
    expect(
      within(bank)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All banks", "Scotiabank", "APAP", "PayPal"]);
    fireEvent.change(bank, { target: { value: "Scotiabank" } });
    expect(merchants()).toEqual(["SUPERMERCADO BRAVO", "SHELL NAVARRETE"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(merchants()).toHaveLength(4);
    expect(bank).toHaveValue("");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("uses the category from the URL and changes it by navigating", () => {
    renderTable({ category: "Restaurantes" });

    expect(merchants()).toEqual(["Café Santo Domingo"]);
    const category = screen.getByLabelText("Category");
    expect(category).toHaveValue("Restaurantes");

    fireEvent.change(category, { target: { value: "Combustible" } });
    expect(mocks.push).toHaveBeenLastCalledWith("/app?month=2026-10&category=Combustible");
    fireEvent.change(category, { target: { value: "" } });
    expect(mocks.push).toHaveBeenLastCalledWith("/app?month=2026-10");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/app?month=2026-10");
  });

  it("saves a new category for a purchase", async () => {
    mocks.updateCategoryAction.mockResolvedValue({ ok: true });
    renderTable();

    fireEvent.change(screen.getByLabelText("Category of NETFLIX.COM"), {
      target: { value: "Entretenimiento" },
    });

    await waitFor(() =>
      expect(mocks.updateCategoryAction).toHaveBeenCalledWith(NETFLIX.id, "Entretenimiento"),
    );
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("ignores and restores purchases", async () => {
    mocks.setIgnoredAction.mockResolvedValue({ ok: true });
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Ignore SUPERMERCADO BRAVO" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore SHELL NAVARRETE" }));

    await waitFor(() => expect(mocks.setIgnoredAction).toHaveBeenCalledTimes(2));
    expect(mocks.setIgnoredAction.mock.calls).toEqual([
      [BRAVO.id, true],
      [SHELL.id, false],
    ]);
  });

  it("shows a change while it is being saved", async () => {
    let resolve!: (value: { ok: true }) => void;
    mocks.setIgnoredAction.mockReturnValue(new Promise((r) => (resolve = r)));
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Ignore SUPERMERCADO BRAVO" }));
    const bravo = await screen.findByRole("button", { name: "Restore SUPERMERCADO BRAVO" });
    expect(bravo.closest("tr")).toHaveTextContent("Ignored");
    expect(screen.getByText(/^4 purchases · RD\$ 1,205\.37/)).toHaveTextContent(
      "(2 ignored left out)",
    );

    resolve({ ok: true });
    // The page data is not revalidated in this test, so the stored value comes back.
    expect(
      await screen.findByRole("button", { name: "Ignore SUPERMERCADO BRAVO" }),
    ).toBeInTheDocument();
  });

  it("says when a change was not saved", async () => {
    mocks.setIgnoredAction.mockResolvedValueOnce({ ok: false, error: "unauthenticated" });
    mocks.updateCategoryAction.mockRejectedValueOnce(new Error("network"));
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Ignore SUPERMERCADO BRAVO" }));
    expect(
      await screen.findByText("Your session expired. Sign in again to save changes."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Category of NETFLIX.COM"), {
      target: { value: "Otros" },
    });
    expect(
      await screen.findByText("Could not save the change. Please try again."),
    ).toBeInTheDocument();
    // The server did not change anything, so the table shows the stored values again.
    await waitFor(() =>
      expect(screen.getByLabelText("Category of NETFLIX.COM")).toHaveValue("Suscripciones"),
    );
    expect(screen.getByRole("button", { name: "Ignore SUPERMERCADO BRAVO" })).toBeVisible();
  });

  it("has a message for a month without purchases", () => {
    renderTable({ transactions: [] });
    expect(screen.getByText("No purchases this month.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });
});
