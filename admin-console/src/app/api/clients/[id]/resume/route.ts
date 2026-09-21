import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireAnyRole } from "@/lib/session";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";
import { findClient, updateKeycloakClient, isProtectedClient } from "@/lib/clientManagementService";
import { metadataForClient, updateClientMetadata } from "@/lib/clientManagementDb";
import { publicClientRepresentation } from "@/lib/clientManagement";

interface RouteParams { params: Promise<{ id: string }>; }

async function setEnabled(req: NextRequest, id: string, enabled: boolean) {
  const auth = await requireAnyRole([config.clientManagerRole], req);
  if (!auth.ok) return auth.response;
  try {
    const current = await findClient(auth.ctx.accessToken, id);
    if (!current || isProtectedClient(current)) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    if (current.clientId === config.clientId) return NextResponse.json({ error: "The Admin Console client cannot be resumed from this route" }, { status: 403 });
    const saved = await updateKeycloakClient(auth.ctx.accessToken, current, { enabled });
    const metadata = await metadataForClient(current.id);
    const savedMetadata = metadata ? await updateClientMetadata(current.id, { status: enabled ? "active" : "suspended" }) : null;
    await logAdminAction(auth.ctx, enabled ? "CLIENT_RESUMED" : "CLIENT_SUSPENDED", undefined, {
      clientId: current.clientId, keycloakClientUuid: current.id,
    });
    return NextResponse.json({ client: saved ? publicClientRepresentation(saved) : null, metadata: savedMetadata });
  } catch (error) {
    return auditedErrorResponse(error, auth.ctx, enabled ? "CLIENT_RESUMED" : "CLIENT_SUSPENDED", undefined, { clientId: id });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return setEnabled(req, id, true);
}
