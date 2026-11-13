import { AdminGate } from "@/components/admin-console/gate";
import { CustomerPage } from "@/components/admin-console/pages/customer";

export const metadata = { title: "Customer" };

export default async function Page({ params }: PageProps<"/admin/customers/[id]">) {
  const { id } = await params;
  return (
    <AdminGate page="customers">
      <CustomerPage id={id} />
    </AdminGate>
  );
}
