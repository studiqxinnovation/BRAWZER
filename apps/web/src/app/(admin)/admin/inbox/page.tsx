import { AdminGate } from "@/components/admin-console/gate";
import { InboxPage } from "@/components/admin-console/pages/inbox";

export const metadata = { title: "Support inbox" };

export default function Page() {
  return (
    <AdminGate page="inbox">
      <InboxPage />
    </AdminGate>
  );
}
