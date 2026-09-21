import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireAnyRole } from "@/lib/session";
import { errorResponse } from "@/lib/http";
import { findClient, clientSecurity, isProtectedClient } from "@/lib/clientManagementService";
import { metadataForClient } from "@/lib/clientManagementDb";
import { findingSummary, publicClientRepresentation, type ClientTemplate, type ClientEnvironment } from "@/lib/clientManagement";

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.clientManagerRole, config.userManagerRole], _req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const client = await findClient(auth.ctx.accessToken, id);
    if (!client || isProtectedClient(client)) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const metadata = await metadataForClient(client.id);
    const validation = findingSummary(clientSecurity(
      client,
      metadata?.applicationType as ClientTemplate | undefined,
      metadata?.environment as ClientEnvironment | undefined,
    ));
    return NextResponse.json({ client: publicClientRepresentation(client), validation });
  } catch (error) { return errorResponse(error); }
}
