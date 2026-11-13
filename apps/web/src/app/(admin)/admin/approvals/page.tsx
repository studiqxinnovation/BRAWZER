import { AdminGate } from "@/components/admin-console/gate";
import { ApprovalsPage } from "@/components/admin-console/pages/approvals";

export const metadata = { title: "Approvals" };

export default function Page() {
  return (
    <AdminGate page="approvals">
      <ApprovalsPage />
    </AdminGate>
  );
}
