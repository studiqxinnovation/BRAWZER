import { connection } from "next/server";

/**
 * The console's own sign-in, outside the console's shell and gate. Rendered
 * for every request so each response carries its own CSP nonce.
 */
export const instant = false;

export default async function ConsoleAuthLayout({ children }: LayoutProps<"/">) {
  await connection();
  return <>{children}</>;
}
