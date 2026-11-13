import { AdminGate } from "@/components/admin-console/gate";
import { LegalPage } from "@/components/admin-console/pages/legal";

export const metadata = { title: "Legal requests & holds" };

export default function Page() {
  return (
    <AdminGate page="legal">
      <LegalPage />
    </AdminGate>
  );
}
