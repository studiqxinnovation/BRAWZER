import { AdminGate } from "@/components/admin-console/gate";
import { AnnouncePage } from "@/components/admin-console/pages/announce";

export const metadata = { title: "In-app announcements" };

export default function Page() {
  return (
    <AdminGate page="announce">
      <AnnouncePage />
    </AdminGate>
  );
}
