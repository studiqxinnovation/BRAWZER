import { AdminGate } from "@/components/admin-console/gate";
import { OrganisationsPage } from "@/components/admin-console/pages/orgs";

export const metadata = { title: "Organisations" };

export default function Page() {
  return (
    <AdminGate page="orgs">
      <OrganisationsPage />
    </AdminGate>
  );
}
