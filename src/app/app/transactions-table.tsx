"use client";

import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";
import { editErrorMessage, type EditResult } from "@/lib/dashboard/edit";
import { dashboardHref, resolveCategory } from "@/lib/dashboard/url";
import { banksIn, filterTransactions, totalDop } from "@/lib/domain/filter";
import { formatMoney } from "@/lib/domain/money";
import { formatDayTime } from "@/lib/domain/month";
import { CATEGORIES, type Bank, type Category, type Transaction } from "@/lib/domain/types";
import { setIgnoredAction, updateCategoryAction } from "./actions";

interface TransactionsTableProps {
  month: string;
  /** The month's transactions, newest first, ignored ones included. */
  transactions: readonly Transaction[];
  usdToDopRate: number;
  /** The `?category=` filter, shared with the category bars. */
  category: Category | null;
}

type Change = { id: string; category: Category } | { id: string; ignored: boolean };

function applyChange(transactions: readonly Transaction[], change: Change): Transaction[] {
  return transactions.map((transaction) =>
    transaction.id === change.id ? { ...transaction, ...change } : transaction,
  );
}

function purchases(count: number): string {
  return count === 1 ? "1 purchase" : `${count} purchases`;
}

const CONTROL = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

// Below `sm` each row becomes a small card: merchant and amount on top, then the date, then
// the category select and the Ignore button. The explicit roles keep the table semantics
// when the display of the table elements changes.
const ROW_NARROW =
  "max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-3 max-sm:gap-y-1 max-sm:py-2.5";

/**
 * The month's purchases with search and bank / category filters. The category of each
 * purchase can be changed in place, and a purchase can be ignored (left out of every total)
 * or restored. Edits show at once and are undone if the server does not save them.
 */
export function TransactionsTable({
  month,
  transactions,
  usdToDopRate,
  category,
}: TransactionsTableProps) {
  const router = useRouter();
  const ids = useId();
  const [search, setSearch] = useState("");
  const [bank, setBank] = useState<Bank | "">("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [shown, applyOptimistic] = useOptimistic(transactions, applyChange);

  const banks = banksIn(transactions);
  const rows = filterTransactions(shown, { search, bank: bank || null, category });
  const filtered = search.trim() !== "" || bank !== "" || category !== null;
  const ignoredCount = rows.filter((row) => row.ignored).length;

  function save(change: Change, action: () => Promise<EditResult>) {
    setError(null);
    startTransition(async () => {
      applyOptimistic(change);
      try {
        const result = await action();
        if (!result.ok) setError(editErrorMessage(result.error));
      } catch {
        setError(editErrorMessage("failed"));
      }
    });
  }

  function pickCategory(value: string) {
    router.push(dashboardHref(month, { category: resolveCategory(value) }));
  }

  function clearFilters() {
    setSearch("");
    setBank("");
    if (category) pickCategory("");
  }

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 id={`${ids}-title`} className="text-sm font-semibold">
          Transactions
        </h3>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            type="search"
            aria-label="Search transactions"
            placeholder="Search merchant, card, amount…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`${CONTROL} w-full sm:w-56`}
          />
          <select
            aria-label="Bank"
            value={bank}
            onChange={(event) => setBank(event.target.value as Bank | "")}
            className={`${CONTROL} min-w-0 flex-1 sm:flex-none`}
          >
            <option value="">All banks</option>
            {banks.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Category"
            value={category ?? ""}
            onChange={(event) => pickCategory(event.target.value)}
            className={`${CONTROL} min-w-0 flex-1 sm:flex-none`}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {filtered && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-accent underline underline-offset-4"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <p role="alert" className="text-sm text-red-600 empty:hidden dark:text-red-400">
        {error}
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          {transactions.length === 0
            ? "No purchases this month."
            : "No purchases match these filters."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table role="table" className="w-full text-sm max-sm:block">
            <thead role="rowgroup" className="text-left text-xs text-muted max-sm:sr-only">
              <tr role="row" className="border-b border-border">
                <th role="columnheader" scope="col" className="py-2 pr-3 font-medium">
                  Date
                </th>
                <th role="columnheader" scope="col" className="py-2 pr-3 font-medium">
                  Merchant
                </th>
                <th role="columnheader" scope="col" className="py-2 pr-3 font-medium">
                  Category
                </th>
                <th role="columnheader" scope="col" className="py-2 pr-3 text-right font-medium">
                  Amount
                </th>
                <th role="columnheader" scope="col" className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-border max-sm:block">
              {rows.map((row) => {
                const when = formatDayTime(row.date);
                return (
                  <tr
                    key={row.id}
                    role="row"
                    className={`${ROW_NARROW} ${row.ignored ? "text-muted" : ""}`}
                  >
                    <td
                      role="cell"
                      className="py-2 pr-3 align-top whitespace-nowrap tabular-nums max-sm:col-span-2 max-sm:row-start-2 max-sm:p-0 max-sm:text-xs max-sm:text-muted"
                    >
                      <span className="block max-sm:inline">{when?.day ?? row.date}</span>
                      <span className="block text-xs text-muted max-sm:inline max-sm:before:content-['_·_']">
                        {when?.time}
                      </span>
                    </td>
                    <td role="cell" className="py-2 pr-3 align-top max-sm:row-start-1 max-sm:p-0">
                      <span className="block font-medium break-words">{row.merchant}</span>
                      <span className="block text-xs text-muted tabular-nums">
                        {row.bank} · <span className="sr-only">card ending in </span>
                        <span aria-hidden="true">•••• </span>
                        {row.cardLast4}
                        {row.ignored && " · Ignored"}
                      </span>
                    </td>
                    <td
                      role="cell"
                      className="py-2 pr-3 align-top max-sm:row-start-3 max-sm:p-0 max-sm:pt-1"
                    >
                      <select
                        aria-label={`Category of ${row.merchant}`}
                        value={row.category}
                        onChange={(event) => {
                          const next = event.target.value as Category;
                          save({ id: row.id, category: next }, () =>
                            updateCategoryAction(row.id, next),
                          );
                        }}
                        className="h-8 max-w-40 rounded-md border border-border bg-surface px-1.5 text-sm"
                      >
                        {CATEGORIES.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td
                      role="cell"
                      className={`py-2 pr-3 text-right align-top whitespace-nowrap tabular-nums max-sm:col-start-2 max-sm:row-start-1 max-sm:p-0 max-sm:font-medium ${
                        row.ignored ? "line-through" : ""
                      }`}
                    >
                      {formatMoney(row.amount, row.currency)}
                    </td>
                    <td
                      role="cell"
                      className="py-2 text-right align-top max-sm:col-start-2 max-sm:row-start-3 max-sm:p-0 max-sm:pt-1"
                    >
                      <button
                        type="button"
                        aria-label={`${row.ignored ? "Restore" : "Ignore"} ${row.merchant}`}
                        onClick={() =>
                          save({ id: row.id, ignored: !row.ignored }, () =>
                            setIgnoredAction(row.id, !row.ignored),
                          )
                        }
                        className="h-8 rounded-md border border-border px-2.5 text-xs hover:bg-accent-soft"
                      >
                        {row.ignored ? "Restore" : "Ignore"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-muted tabular-nums">
          {filtered
            ? `${purchases(rows.length)} of ${transactions.length}`
            : purchases(rows.length)}
          {" · "}
          {formatMoney(totalDop(rows, usdToDopRate), "DOP")}
          {ignoredCount > 0 && ` (${ignoredCount} ignored left out)`}
        </p>
      )}
    </section>
  );
}
