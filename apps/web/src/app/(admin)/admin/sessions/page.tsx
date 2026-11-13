import { AdminGate } from "@/components/admin-console/gate";
import { LiveSessionsPage } from "@/components/admin-console/pages/sessions";

export const metadata = { title: "Live sessions" };

export default function Page() {
  return (
    <AdminGate page="sessions">
      <LiveSessionsPage />
    </AdminGate>
  );
}
