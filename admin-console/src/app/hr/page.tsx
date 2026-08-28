import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import HrDashboardClient from "./HrDashboardClient";

export default async function HrPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/signin?callbackUrl=%2Fhr");
  }
  if (!session.isRealmAdmin && !session.roles?.includes(config.userManagerRole)) {
    redirect("/");
  }

  return (
    <HrDashboardClient
      username={session.user?.name ?? session.userId ?? "unknown"}
      showGroupsLink
    />
  );
}
