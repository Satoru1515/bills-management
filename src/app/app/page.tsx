import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth/redirect";
import { loadDashboard } from "@/lib/dashboard/load";
import { formatMonthLabel, resolveMonth } from "@/lib/domain/month";
import { createClient } from "@/lib/supabase/server";
import { KpiCards } from "./kpi-cards";
import { MonthPicker } from "./month-picker";
import { SyncButton } from "./sync-button";

export const metadata = { title: "Bills Management" };

interface AppHomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Dashboard for `?month=YYYY-MM` (the current month by default). */
export default async function AppHome({ searchParams }: AppHomeProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The middleware already guards /app; this check is a second line.
  if (!user) redirect(LOGIN_PATH);

  const now = new Date();
  const month = resolveMonth((await searchParams).month, now);
  const data = await loadDashboard(supabase, user.id, month, now);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">{formatMonthLabel(month)}</h2>
        <MonthPicker month={month} maxMonth={data.maxMonth} />
      </div>
      <KpiCards data={data} />
      <SyncButton />
    </>
  );
}
