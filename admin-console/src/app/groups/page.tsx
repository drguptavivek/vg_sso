import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import GroupsDashboardClient from "./GroupsDashboardClient";

export default async function GroupsPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/api/auth/signin");
  }
  if (!session.isRealmAdmin && !session.roles?.includes(config.delegatedClientAdminRole)) {
    redirect("/");
  }

  return (
    <GroupsDashboardClient
      username={session.user?.name ?? session.userId ?? "unknown"}
      showHrLink={session.isRealmAdmin}
      isRealmAdmin={session.isRealmAdmin}
    />
  );
}
