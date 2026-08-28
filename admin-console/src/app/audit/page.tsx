import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import AuditDashboardClient from "./AuditDashboardClient";

export default async function AuditPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin?callbackUrl=%2Faudit");
  if (session.isRealmAdmin !== true) redirect("/");
  return <AuditDashboardClient username={session.user?.name ?? session.userId ?? "unknown"} />;
}
