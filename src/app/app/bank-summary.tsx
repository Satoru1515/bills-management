import type { BankTotal } from "@/lib/domain/breakdown";
import { formatMoney } from "@/lib/domain/money";
import type { Category } from "@/lib/domain/types";

interface BankSummaryProps {
  totals: readonly BankTotal[];
  /** The category the totals are limited to, if any. */
  category: Category | null;
}

function purchases(count: number): string {
  return count === 1 ? "1 purchase" : `${count} purchases`;
}

/** Spending per bank and, under each bank, per card (last 4 digits only). */
export function BankSummary({ totals, category }: BankSummaryProps) {
  return (
    <section aria-labelledby="by-bank" className="flex flex-col gap-3">
      <h3 id="by-bank" className="text-sm font-semibold">
        By bank and card
        {category && <span className="font-normal text-muted"> · {category}</span>}
      </h3>
      {totals.length === 0 ? (
        <p className="text-sm text-muted">
          {category ? `No ${category} purchases this month.` : "No purchases this month."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {totals.map((bank) => (
            <li key={bank.bank} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{bank.bank}</span>
                <span className="tabular-nums">{formatMoney(bank.totalDop, "DOP")}</span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {bank.cards.map((card) => (
                  <li
                    key={card.cardLast4}
                    className="flex items-baseline justify-between gap-3 text-xs text-muted"
                  >
                    <span className="tabular-nums">
                      <span className="sr-only">Card ending in </span>
                      <span aria-hidden="true">•••• </span>
                      {card.cardLast4} · {purchases(card.count)}
                    </span>
                    <span className="tabular-nums">{formatMoney(card.totalDop, "DOP")}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
