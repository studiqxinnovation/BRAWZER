import { AdminGate } from "@/components/admin-console/gate";
import { GrowthPage } from "@/components/admin-console/pages/growth";

export const metadata = { title: "Growth & retention" };

export default function Page() {
  return (
    <AdminGate page="growth">
      <GrowthPage />
    </AdminGate>
  );
}
