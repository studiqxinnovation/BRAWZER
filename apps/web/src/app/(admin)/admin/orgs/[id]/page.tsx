import { AdminGate } from "@/components/admin-console/gate";
import { OrganisationPage } from "@/components/admin-console/pages/org";

export const metadata = { title: "Organisation" };

export default async function Page({ params }: PageProps<"/admin/orgs/[id]">) {
  const { id } = await params;
  return (
    <AdminGate page="orgs">
      <OrganisationPage id={id} />
    </AdminGate>
  );
}
