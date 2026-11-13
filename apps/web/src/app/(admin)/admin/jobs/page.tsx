import { AdminGate } from "@/components/admin-console/gate";
import { JobsPage } from "@/components/admin-console/pages/jobs";

export const metadata = { title: "Queues & health" };

export default function Page() {
  return (
    <AdminGate page="jobs">
      <JobsPage />
    </AdminGate>
  );
}
