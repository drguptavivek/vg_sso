import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import GroupsDashboardClient from "./GroupsDashboardClient";

export default async function GroupsPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/signin?callbackUrl=%2Fgroups");
  }
  const isUserManager = session.roles?.includes(config.userManagerRole) ?? false;
  const isGroupManager = session.roles?.includes(config.groupManagerRole) ?? false;
  const isDelegatedAdmin = session.roles?.includes(config.delegatedClientAdminRole) ?? false;
  if (!session.isRealmAdmin && !isUserManager && !isGroupManager && !isDelegatedAdmin) {
    redirect("/");
  }

  return (
    <GroupsDashboardClient
      username={session.user?.name ?? session.userId ?? "unknown"}
      showHrLink={session.isRealmAdmin || isUserManager}
      isRealmAdmin={session.isRealmAdmin}
      isUserManager={isUserManager}
      isGroupManager={isGroupManager}
      canManageApplicationRoles={session.isRealmAdmin || isGroupManager || isDelegatedAdmin}
    />
  );
}
