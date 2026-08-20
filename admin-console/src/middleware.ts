import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const USER_MANAGER_ROLE = process.env.ADMIN_CONSOLE_USER_MANAGER_ROLE ?? "user-manager";
const DELEGATED_CLIENT_ADMIN_ROLE =
  process.env.ADMIN_CONSOLE_DELEGATED_CLIENT_ADMIN_ROLE ?? "delegated-client-admin-base";

export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ req, token }) {
        if (!token) {
          return false;
        }
        const roles = (token.roles as string[] | undefined) ?? [];
        const path = req.nextUrl.pathname;
        if (path.startsWith("/hr")) {
          return roles.includes(USER_MANAGER_ROLE);
        }
        if (path.startsWith("/groups")) {
          return roles.includes(DELEGATED_CLIENT_ADMIN_ROLE);
        }
        return true;
      },
    },
  },
);

export const config = {
  matcher: ["/hr/:path*", "/groups/:path*"],
};
