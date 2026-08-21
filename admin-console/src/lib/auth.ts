import type { NextAuthOptions, Profile } from "next-auth";
import { config, keycloakRealmInternalUrl, keycloakRealmPublicUrl } from "./config";
import { isRealmAdminFromAccessToken, realmRolesFromAccessToken } from "./jwt";

interface KeycloakProfile extends Profile {
  sub: string;
  preferred_username?: string;
  email?: string;
  name?: string;
}

interface RefreshedTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function refreshAccessToken(refreshToken: string): Promise<RefreshedTokens | null> {
  try {
    const res = await fetch(`${keycloakRealmInternalUrl()}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as RefreshedTokens;
  } catch {
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  secret: config.nextAuthSecret,
  session: { strategy: "jwt" },
  providers: [
    {
      id: "keycloak",
      name: "Keycloak",
      type: "oauth",
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      issuer: keycloakRealmPublicUrl(),
      jwks_endpoint: `${keycloakRealmInternalUrl()}/protocol/openid-connect/certs`,
      idToken: true,
      checks: ["pkce", "state"],
      authorization: {
        // Browser-navigated: must be reachable from the user's machine.
        url: `${keycloakRealmPublicUrl()}/protocol/openid-connect/auth`,
        params: { scope: "openid email profile" },
      },
      token: {
        // Server-to-server: uses the internal (docker-network) URL when configured.
        url: `${keycloakRealmInternalUrl()}/protocol/openid-connect/token`,
      },
      userinfo: {
        url: `${keycloakRealmInternalUrl()}/protocol/openid-connect/userinfo`,
      },
      profile(profile: KeycloakProfile) {
        return {
          id: profile.sub,
          name: profile.name ?? profile.preferred_username ?? profile.sub,
          email: profile.email,
          username: profile.preferred_username,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (account && user) {
        // Initial sign-in.
        token.accessToken = account.access_token as string;
        token.refreshToken = account.refresh_token as string | undefined;
        token.accessTokenExpires = Date.now() + Number(account.expires_in ?? 60) * 1000;
        token.roles = realmRolesFromAccessToken(account.access_token as string);
        token.isRealmAdmin = isRealmAdminFromAccessToken(account.access_token as string);
        token.userId = user.id;
        token.username = (user as { username?: string }).username;
        delete token.error;
        return token;
      }

      if (typeof token.accessTokenExpires === "number" && Date.now() < token.accessTokenExpires - 5_000) {
        return token;
      }

      if (!token.refreshToken) {
        return { ...token, error: "RefreshAccessTokenError" as const };
      }

      const refreshed = await refreshAccessToken(token.refreshToken as string);
      if (!refreshed) {
        return { ...token, error: "RefreshAccessTokenError" as const };
      }

      return {
        ...token,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? token.refreshToken,
        accessTokenExpires: Date.now() + refreshed.expires_in * 1000,
        roles: realmRolesFromAccessToken(refreshed.access_token),
        isRealmAdmin: isRealmAdminFromAccessToken(refreshed.access_token),
        error: undefined,
      };
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.error = token.error as string | undefined;
      session.roles = (token.roles as string[] | undefined) ?? [];
      session.isRealmAdmin = token.isRealmAdmin === true;
      session.userId = token.userId as string | undefined;
      if (session.user) {
        (session.user as { username?: string }).username = token.username as string | undefined;
      }
      return session;
    },
  },
};
