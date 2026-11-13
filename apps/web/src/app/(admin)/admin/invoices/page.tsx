import { AdminGate } from "@/components/admin-console/gate";
import { InvoicesPage } from "@/components/admin-console/pages/invoices";

export const metadata = { title: "Invoices & refunds" };

export default function Page() {
  return (
    <AdminGate page="invoices">
      <InvoicesPage />
    </AdminGate>
  );
}
