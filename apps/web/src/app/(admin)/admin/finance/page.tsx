import { AdminGate } from "@/components/admin-console/gate";
import { FinancePage } from "@/components/admin-console/pages/finance";

export const metadata = { title: "Finance reports" };

export default function Page() {
  return (
    <AdminGate page="finance">
      <FinancePage />
    </AdminGate>
  );
}
