import { requireAdmin } from "../../lib/auth";
import AdminClient from "./admin-client";
import Link from "next/link";
import { MidasCatIcon } from "@/components/midas-cat-icon";

export const dynamic = "force-dynamic";

async function hasAdminAccess() {
  try {
    await requireAdmin();
    return true;
  } catch {
    return false;
  }
}

export default async function AdminPage() {
  const authorized = await hasAdminAccess();
  if (!authorized) {
    return (
      <main className="midas-app dark admin-denied">
        <MidasCatIcon className="loading-cat" priority size={92} />
        <h1>Acceso restringido</h1>
        <p>ADMIN está disponible exclusivamente para usuarios autorizados.</p>
        <Link href="/">Volver a MIDAS</Link>
      </main>
    );
  }
  return <AdminClient />;
}
