import { AdminGate } from "@/components/admin-console/gate";
import { RecoveryPage } from "@/components/admin-console/pages/recovery";

export const metadata = { title: "Account recovery" };

export default function Page() {
  return (
    <AdminGate page="recovery">
      <RecoveryPage />
    </AdminGate>
  );
}
