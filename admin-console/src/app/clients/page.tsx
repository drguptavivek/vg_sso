import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import ClientsDashboardClient from "./ClientsDashboardClient";

export default async function ClientsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin?callbackUrl=%2Fclients");
  const isClientManager = session.roles?.includes(config.clientManagerRole) ?? false;
  const isUserManager = session.roles?.includes(config.userManagerRole) ?? false;
  if (!session.isRealmAdmin && !isClientManager && !isUserManager) redirect("/");

  return (
    <ClientsDashboardClient
      username={session.user?.name ?? session.userId ?? "unknown"}
      canManageAdministrators={session.isRealmAdmin || isClientManager}
      canManageClients={session.isRealmAdmin || isClientManager}
      isRealmAdmin={session.isRealmAdmin}
    />
  );
}
