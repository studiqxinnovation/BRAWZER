import { AdminGate } from "@/components/admin-console/gate";
import { DataMapPage } from "@/components/admin-console/pages/datamap";

export const metadata = { title: "Data map & suppliers" };

export default function Page() {
  return (
    <AdminGate page="dataMap">
      <DataMapPage />
    </AdminGate>
  );
}
