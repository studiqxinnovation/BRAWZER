import { AdminGate } from "@/components/admin-console/gate";
import { NetworkPage } from "@/components/admin-console/pages/network";

export const metadata = { title: "Proxy & Shield" };

export default function Page() {
  return (
    <AdminGate page="network">
      <NetworkPage />
    </AdminGate>
  );
}
