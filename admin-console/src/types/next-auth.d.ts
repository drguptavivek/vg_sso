import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    /** Server-only, non-enumerable; never serialized by /api/auth/session. */
    accessToken?: string;
    error?: string;
    roles: string[];
    isRealmAdmin: boolean;
    userId?: string;
    user?: DefaultSession["user"] & { username?: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    roles?: string[];
    isRealmAdmin?: boolean;
    userId?: string;
    username?: string;
    error?: string;
  }
}
