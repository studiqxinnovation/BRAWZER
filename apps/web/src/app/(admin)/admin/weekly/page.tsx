import { AdminGate } from "@/components/admin-console/gate";
import { WeeklyPage } from "@/components/admin-console/pages/weekly";

export const metadata = { title: "Weekly email" };

export default function Page() {
  return (
    <AdminGate page="weekly">
      <WeeklyPage />
    </AdminGate>
  );
}
