import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/SignOutButton";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/signin?callbackUrl=%2F");
  }

  const roles = session.roles ?? [];
  if (session.isRealmAdmin) {
    redirect("/hr");
  }
  if (roles.includes(config.userManagerRole)) {
    redirect("/hr");
  }
  if (roles.includes(config.delegatedClientAdminRole)) {
    redirect("/groups");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Admin Console</CardTitle>
          <CardDescription>No matching role for this account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            Signed in as <strong>{session.user?.name ?? session.userId}</strong>, but this account has
            neither the <code className="rounded bg-muted px-1 py-0.5">{config.userManagerRole}</code> nor
            the{" "}
            <code className="rounded bg-muted px-1 py-0.5">{config.delegatedClientAdminRole}</code> realm
            role.
          </p>
          <p className="text-muted-foreground">
            Ask a realm administrator to grant one of these roles, then sign in again.
          </p>
          <SignOutButton variant="outline" />
        </CardContent>
      </Card>
    </div>
  );
}
