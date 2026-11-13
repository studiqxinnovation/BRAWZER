import { AdminGate } from "@/components/admin-console/gate";
import { TrialsPage } from "@/components/admin-console/pages/trials";

export const metadata = { title: "Accounts likely to upgrade" };

export default function Page() {
  return (
    <AdminGate page="trials">
      <TrialsPage />
    </AdminGate>
  );
}
