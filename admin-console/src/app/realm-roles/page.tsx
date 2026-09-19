import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import RealmRolesDashboardClient from "./RealmRolesDashboardClient";

export default async function RealmRolesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin?callbackUrl=%2Frealm-roles");
  if (!session.isRealmAdmin) redirect("/");
  return <RealmRolesDashboardClient username={session.user?.name ?? session.userId ?? "unknown"} />;
}
