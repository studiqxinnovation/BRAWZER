import { AdminGate } from "@/components/admin-console/gate";
import { AbusePage } from "@/components/admin-console/pages/abuse";

export const metadata = { title: "Abuse reports" };

export default function Page() {
  return (
    <AdminGate page="abuse">
      <AbusePage />
    </AdminGate>
  );
}
