import { AdminGate } from "@/components/admin-console/gate";
import { TeamPage } from "@/components/admin-console/pages/team";

export const metadata = { title: "Team & access" };

export default function Page() {
  return (
    <AdminGate page="team">
      <TeamPage />
    </AdminGate>
  );
}
