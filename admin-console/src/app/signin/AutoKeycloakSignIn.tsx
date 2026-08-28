"use client";

import { useEffect, useRef } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function AutoKeycloakSignIn({ callbackUrl, realmName }: { callbackUrl: string; realmName: string }) {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void signIn("keycloak", { callbackUrl });
  }, [callbackUrl]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Connecting to {realmName} SSO</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Checking your existing Keycloak session…
        </p>
        <Button className="mt-5 w-full" onClick={() => signIn("keycloak", { callbackUrl })}>
          Continue with Keycloak
        </Button>
      </div>
    </div>
  );
}
