import { AdminGate } from "@/components/admin-console/gate";
import { CouponsPage } from "@/components/admin-console/pages/coupons";

export const metadata = { title: "Coupons" };

export default function Page() {
  return (
    <AdminGate page="coupons">
      <CouponsPage />
    </AdminGate>
  );
}
