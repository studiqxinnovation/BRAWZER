import { AdminGate } from "@/components/admin-console/gate";
import { ExtensionsPage } from "@/components/admin-console/pages/extensions";

export const metadata = { title: "Extension catalogue" };

export default function Page() {
  return (
    <AdminGate page="extensions">
      <ExtensionsPage />
    </AdminGate>
  );
}
