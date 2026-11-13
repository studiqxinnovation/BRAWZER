import { AdminGate } from "@/components/admin-console/gate";
import { ImagesPage } from "@/components/admin-console/pages/images";

export const metadata = { title: "Browser images" };

export default function Page() {
  return (
    <AdminGate page="images">
      <ImagesPage />
    </AdminGate>
  );
}
