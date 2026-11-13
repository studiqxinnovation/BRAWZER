import { AdminGate } from "@/components/admin-console/gate";
import { AuditPage } from "@/components/admin-console/pages/audit";

export const metadata = { title: "Audit log" };

export default function Page() {
  return (
    <AdminGate page="audit">
      <AuditPage />
    </AdminGate>
  );
}
