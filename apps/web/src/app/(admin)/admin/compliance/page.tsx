import { AdminGate } from "@/components/admin-console/gate";
import { CompliancePage } from "@/components/admin-console/pages/compliance";

export const metadata = { title: "Compliance" };

export default function Page() {
  return (
    <AdminGate page="compliance">
      <CompliancePage />
    </AdminGate>
  );
}
