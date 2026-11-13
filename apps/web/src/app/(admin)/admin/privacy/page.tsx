import { AdminGate } from "@/components/admin-console/gate";
import { PrivacyPage } from "@/components/admin-console/pages/privacy";

export const metadata = { title: "Privacy requests" };

export default function Page() {
  return (
    <AdminGate page="privacy">
      <PrivacyPage />
    </AdminGate>
  );
}
