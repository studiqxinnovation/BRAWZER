import { AdminGate } from "@/components/admin-console/gate";
import { FleetPage } from "@/components/admin-console/pages/fleet";

export const metadata = { title: "Fleet & regions" };

export default function Page() {
  return (
    <AdminGate page="fleet">
      <FleetPage />
    </AdminGate>
  );
}
