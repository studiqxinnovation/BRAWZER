import { AdminGate } from "@/components/admin-console/gate";
import { SubscriptionsPage } from "@/components/admin-console/pages/subs";

export const metadata = { title: "Subscriptions" };

export default function Page() {
  return (
    <AdminGate page="subs">
      <SubscriptionsPage />
    </AdminGate>
  );
}
