"use client";

/** Shown when the dashboard data cannot be loaded (details stay in the server logs). */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p className="text-sm">Your spending could not be loaded. Please try again.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-current/20 px-4 py-2 text-sm font-medium"
      >
        Try again
      </button>
    </div>
  );
}
