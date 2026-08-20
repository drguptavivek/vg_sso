import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  const roles = session.roles ?? [];
  if (roles.includes(config.userManagerRole)) {
    redirect("/hr");
  }
  if (roles.includes(config.delegatedClientAdminRole)) {
    redirect("/groups");
  }

  return (
    <div className="wrap">
      <div className="card">
        <h1>Admin Console</h1>
        <p>
          Signed in as <strong>{session.user?.name ?? session.userId}</strong>, but this account has
          neither the <code>{config.userManagerRole}</code> nor the{" "}
          <code>{config.delegatedClientAdminRole}</code> realm role.
        </p>
        <p className="muted">
          Ask a realm administrator to grant one of these roles, then sign in again.
        </p>
        <a href="/api/auth/signout">Sign out</a>
      </div>
    </div>
  );
}
