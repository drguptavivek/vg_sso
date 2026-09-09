import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { getOwnedRootPaths, isWithinOwnedTree } from "@/lib/ownership";
import type { KcGroup } from "@/types/keycloak";
import { logAdminAction } from "@/lib/actionAudit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.delegatedClientAdminRole, config.groupManagerRole], req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as { name?: string };
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const [current, ownedRootPaths] = await Promise.all([
      kcAdminRequest<KcGroup>(auth.ctx.accessToken, `/groups/${id}`),
      getOwnedRootPaths(auth.ctx.accessToken, auth.ctx.userId, auth.ctx.isRealmAdmin || auth.ctx.roles.includes(config.groupManagerRole)),
    ]);
    const parent = current.data;
    if (!parent) {
      return NextResponse.json({ error: "Parent group not found" }, { status: 404 });
    }
    const parentSegments = parent.path.split("/").filter(Boolean);
    if (auth.ctx.roles.includes(config.groupManagerRole) && parentSegments[0] === config.appRolesGroupName && parentSegments.length < 2) {
      return NextResponse.json({ error: "Create app-specific subgroups under an application root, not directly under AppRoles" }, { status: 403 });
    }
    // Creating a child is allowed on the owned root itself, or any descendant of it.
    if (!auth.ctx.roles.includes(config.groupManagerRole) && !isWithinOwnedTree(parent.path, ownedRootPaths)) {
      return NextResponse.json(
        { error: "You may only create groups inside your own AppRoles subtree" },
        { status: 403 },
      );
    }

    await kcAdminRequest(auth.ctx.accessToken, `/groups/${id}/children`, {
      method: "POST",
      body: { name: body.name.trim() },
    });
    await logAdminAction(auth.ctx, "group.create", undefined, { parentGroupId: id, parentPath: parent.path, name: body.name.trim() });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
