import { AdminGate } from "@/components/admin-console/gate";
import { CustomersPage } from "@/components/admin-console/pages/customers";

export const metadata = { title: "Customers" };

export default function Page() {
  return (
    <AdminGate page="customers">
      <CustomersPage />
    </AdminGate>
  );
}
