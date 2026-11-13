import { AdminGate } from "@/components/admin-console/gate";
import { SecurityPage } from "@/components/admin-console/pages/security";

export const metadata = { title: "Threats & sign-ins" };

export default function Page() {
  return (
    <AdminGate page="security">
      <SecurityPage />
    </AdminGate>
  );
}
