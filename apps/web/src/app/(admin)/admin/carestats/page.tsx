import { AdminGate } from "@/components/admin-console/gate";
import { CareStatsPage } from "@/components/admin-console/pages/carestats";

export const metadata = { title: "Support performance" };

export default function Page() {
  return (
    <AdminGate page="carestats">
      <CareStatsPage />
    </AdminGate>
  );
}
