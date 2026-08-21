import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    accessToken?: string;
    error?: string;
    roles: string[];
    userId?: string;
    user?: DefaultSession["user"] & { username?: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    accessTokenExpires?: number;
    roles?: string[];
    userId?: string;
    username?: string;
    error?: string;
  }
}
