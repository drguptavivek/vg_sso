import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/SignOutButton";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-2xl">
          <CardHeader className="items-center text-center">
            {/* Asset is supplied locally by `make apply-branding`; it is never committed. */}
            <img src="/brand/logo.png" alt="" className="mb-2 max-h-20 max-w-56 object-contain" />
            <CardTitle className="text-2xl">{config.realm} SSO</CardTitle>
            <CardDescription>Sign in to the administration console or create your SSO account.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Button asChild size="lg"><Link href="/signin?callbackUrl=%2F">Sign in</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/register">Self-register</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/help">Registration help</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
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
