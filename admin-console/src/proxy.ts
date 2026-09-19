import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const USER_MANAGER_ROLE = process.env.ADMIN_CONSOLE_USER_MANAGER_ROLE ?? "user-manager";
const CLIENT_MANAGER_ROLE = process.env.ADMIN_CONSOLE_CLIENT_MANAGER_ROLE ?? "client-manager";
const GROUP_MANAGER_ROLE = process.env.ADMIN_CONSOLE_GROUP_MANAGER_ROLE ?? "group-manager-fgap";
const AUDITOR_ROLE = process.env.ADMIN_CONSOLE_AUDITOR_ROLE ?? "auditor";
const DELEGATED_CLIENT_ADMIN_ROLE =
  process.env.ADMIN_CONSOLE_DELEGATED_CLIENT_ADMIN_ROLE ?? "delegated-client-admin-base";

export default withAuth(
  function proxy() {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ req, token }) {
        if (!token) {
          return false;
        }
        const roles = (token.roles as string[] | undefined) ?? [];
        const isRealmAdmin = token.isRealmAdmin === true;
        const path = req.nextUrl.pathname;
        if (path.startsWith("/hr")) {
          return isRealmAdmin || roles.includes(USER_MANAGER_ROLE);
        }
        if (path.startsWith("/groups")) {
          return isRealmAdmin || roles.includes(USER_MANAGER_ROLE) || roles.includes(CLIENT_MANAGER_ROLE) || roles.includes(GROUP_MANAGER_ROLE) || roles.includes(DELEGATED_CLIENT_ADMIN_ROLE);
        }
        if (path.startsWith("/clients")) {
          return isRealmAdmin || roles.includes(USER_MANAGER_ROLE) || roles.includes(CLIENT_MANAGER_ROLE);
        }
        if (path.startsWith("/audit")) {
          return isRealmAdmin || roles.some((role) => [USER_MANAGER_ROLE, CLIENT_MANAGER_ROLE, GROUP_MANAGER_ROLE, DELEGATED_CLIENT_ADMIN_ROLE, AUDITOR_ROLE].includes(role));
        }
        if (path.startsWith("/realm-roles")) {
          return isRealmAdmin;
        }
        return true;
      },
    },
  },
);

export const config = {
  matcher: ["/hr/:path*", "/groups/:path*", "/clients/:path*", "/realm-roles/:path*", "/audit/:path*"],
};
