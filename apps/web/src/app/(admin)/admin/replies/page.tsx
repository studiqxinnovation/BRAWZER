import { AdminGate } from "@/components/admin-console/gate";
import { RepliesPage } from "@/components/admin-console/pages/replies";

export const metadata = { title: "Saved replies" };

export default function Page() {
  return (
    <AdminGate page="replies">
      <RepliesPage />
    </AdminGate>
  );
}
