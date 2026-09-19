import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import AuditDashboardClient from "./AuditDashboardClient";

export default async function AuditPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin?callbackUrl=%2Faudit");
  const mayView = session.isRealmAdmin === true || [config.userManagerRole, config.clientManagerRole, config.groupManagerRole, config.delegatedClientAdminRole, config.auditorRole].some((role) => session.roles?.includes(role));
  if (!mayView) redirect("/");
  return <AuditDashboardClient username={session.user?.name ?? session.userId ?? "unknown"} globalView={session.isRealmAdmin === true || session.roles?.includes(config.auditorRole) === true} />;
}
