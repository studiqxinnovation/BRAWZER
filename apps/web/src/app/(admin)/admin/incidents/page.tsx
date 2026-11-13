import { AdminGate } from "@/components/admin-console/gate";
import { IncidentsPage } from "@/components/admin-console/pages/incidents";

export const metadata = { title: "Incidents & status" };

export default function Page() {
  return (
    <AdminGate page="incidents">
      <IncidentsPage />
    </AdminGate>
  );
}
