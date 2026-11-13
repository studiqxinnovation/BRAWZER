import { AdminGate } from "@/components/admin-console/gate";
import { GoalsPage } from "@/components/admin-console/pages/goals";

export const metadata = { title: "Goals" };

export default function Page() {
  return (
    <AdminGate page="goals">
      <GoalsPage />
    </AdminGate>
  );
}
