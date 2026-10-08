"use client";

import { useActionState, useState } from "react";
import { DEFAULT_USD_TO_DOP_RATE, formatRate } from "@/lib/domain/money";
import { INITIAL_RATE_FORM_STATE } from "@/lib/settings/rate";
import { saveRateAction } from "./actions";

interface RateFormProps {
  /** The user's saved rate, or null when the app default is used. */
  rate: number | null;
}

/** USD → DOP rate used to convert dollar purchases in every total. Empty = app default. */
export function RateForm({ rate }: RateFormProps) {
  const [state, action, pending] = useActionState(saveRateAction, INITIAL_RATE_FORM_STATE);
  // Controlled, so a rejected value stays in the box to be fixed.
  const [value, setValue] = useState(rate === null ? "" : String(rate));

  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="usd-to-dop-rate" className="text-sm">
        Pesos per US dollar
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="usd-to-dop-rate"
          name="rate"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={formatRate(DEFAULT_USD_TO_DOP_RATE)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby="usd-to-dop-rate-hint usd-to-dop-rate-status"
          className="h-9 w-32 rounded-md border border-border bg-surface px-2 text-sm tabular-nums"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-accent-soft disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p id="usd-to-dop-rate-hint" className="text-xs text-muted">
        {rate === null
          ? `Using the default rate of ${formatRate(DEFAULT_USD_TO_DOP_RATE)}. `
          : `Saved rate: ${formatRate(rate)}. `}
        Leave the box empty to use the default.
      </p>
      <p
        id="usd-to-dop-rate-status"
        role="status"
        className={`text-sm ${state.status === "error" ? "text-red-600 dark:text-red-400" : "text-muted"}`}
      >
        {state.message}
      </p>
    </form>
  );
}
