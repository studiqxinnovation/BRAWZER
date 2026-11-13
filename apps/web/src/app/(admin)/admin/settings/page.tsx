import { AdminGate } from "@/components/admin-console/gate";
import { SettingsPage } from "@/components/admin-console/pages/settings";

export const metadata = { title: "Plans & settings" };

export default function Page() {
  return (
    <AdminGate page="settings">
      <SettingsPage />
    </AdminGate>
  );
}
