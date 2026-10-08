import { changeTone, formatChange, type ChangeTone } from "@/lib/domain/money";

const TONE_CLASS: Record<ChangeTone, string> = {
  worse: "text-red-600 dark:text-red-400",
  better: "text-emerald-600 dark:text-emerald-400",
  same: "text-muted",
};

const ARROW: Record<ChangeTone, string> = { worse: "▲", better: "▼", same: "" };

const MEANING: Record<ChangeTone, string> = {
  worse: "more spending",
  better: "less spending",
  same: "about the same",
};

/**
 * A change in spending such as `▲ +12.3%` in red (spent more) or `▼ −8.0%` in green (spent
 * less). Shows `—` when there is nothing to compare with.
 */
export function ChangeBadge({
  change,
  className = "",
}: {
  change: number | null;
  className?: string;
}) {
  if (change === null) {
    return <span className={`text-muted ${className}`}>—</span>;
  }
  const tone = changeTone(change);
  const text = formatChange(change);
  return (
    <span className={`whitespace-nowrap ${TONE_CLASS[tone]} ${className}`} title={MEANING[tone]}>
      {ARROW[tone] && (
        <span aria-hidden="true" className="mr-0.5 text-[0.7em]">
          {ARROW[tone]}
        </span>
      )}
      {text}
    </span>
  );
}
