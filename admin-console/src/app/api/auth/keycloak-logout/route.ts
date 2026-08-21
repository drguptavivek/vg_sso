import { NextResponse } from "next/server";
import { config, keycloakRealmPublicUrl } from "@/lib/config";

export function GET() {
  const logoutUrl = new URL(`${keycloakRealmPublicUrl()}/protocol/openid-connect/logout`);
  logoutUrl.searchParams.set("client_id", config.clientId);
  logoutUrl.searchParams.set("post_logout_redirect_uri", config.appUrl);
  return NextResponse.redirect(logoutUrl);
}
