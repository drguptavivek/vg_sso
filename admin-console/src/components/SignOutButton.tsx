"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignOutButton({ variant = "ghost" }: { variant?: "ghost" | "outline" }) {
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    await signOut({ redirect: false });
    window.location.assign("/api/auth/keycloak-logout");
  }

  return (
    <Button type="button" variant={variant} onClick={handleSignOut} disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
