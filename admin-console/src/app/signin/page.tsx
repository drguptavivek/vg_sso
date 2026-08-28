import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { AutoKeycloakSignIn } from "./AutoKeycloakSignIn";

function safeCallback(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const [{ callbackUrl: requestedCallback }, session] = await Promise.all([
    searchParams,
    getServerSession(authOptions),
  ]);
  const callbackUrl = safeCallback(requestedCallback);
  if (session && !session.error) redirect(callbackUrl);
  return <AutoKeycloakSignIn callbackUrl={callbackUrl} />;
}
