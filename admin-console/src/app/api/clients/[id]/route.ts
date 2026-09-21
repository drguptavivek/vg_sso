import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireAnyRole } from "@/lib/session";
import { errorResponse } from "@/lib/http";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";
import { findClient, appRolesForClient, clientSecurity, updateKeycloakClient, isProtectedClient } from "@/lib/clientManagementService";
import { updateClientSchema, findingSummary, validateClientRequest, postLogoutRedirectAttribute, postLogoutRedirectUrisForClient, POST_LOGOUT_REDIRECT_ATTRIBUTE, publicClientRepresentation, type ClientTemplate, type ClientEnvironment } from "@/lib/clientManagement";
import { metadataForClient, updateClientMetadata } from "@/lib/clientManagementDb";

interface RouteParams { params: Promise<{ id: string }>; }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.clientManagerRole, config.userManagerRole], _req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const client = await findClient(auth.ctx.accessToken, id);
    if (!client || isProtectedClient(client)) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const metadata = await metadataForClient(client.id);
    const appRoles = await appRolesForClient(auth.ctx.accessToken, client.clientId);
    return NextResponse.json({
      client: publicClientRepresentation(client),
      metadata: metadata ?? null,
      appRolesGroup: appRoles.root,
      administrators: appRoles.administrators,
      roleGroups: appRoles.roleGroups,
      security: findingSummary(clientSecurity(client, metadata?.applicationType as ClientTemplate | undefined, metadata?.environment as ClientEnvironment | undefined)),
    });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAnyRole([config.clientManagerRole], req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = updateClientSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid client update", details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  try {
    const current = await findClient(auth.ctx.accessToken, id);
    if (!current || isProtectedClient(current)) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const metadata = await metadataForClient(current.id);
    const template = (metadata?.applicationType ?? (current.serviceAccountsEnabled ? "m2m" : current.publicClient ? "spa" : "server-web")) as ClientTemplate;
    const environment = (metadata?.environment ?? "development") as ClientEnvironment;
    const effective = {
      template,
      clientId: current.clientId,
      environment,
      redirectUris: input.redirectUris ?? current.redirectUris ?? [],
      postLogoutRedirectUris: input.postLogoutRedirectUris ?? postLogoutRedirectUrisForClient(current),
      webOrigins: input.webOrigins ?? current.webOrigins ?? [],
    };
    const validation = findingSummary(validateClientRequest(effective));
    if (!validation.valid) return NextResponse.json({ error: "Client security validation failed", validation }, { status: 400 });

    const clientPatch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.redirectUris !== undefined ? { redirectUris: input.redirectUris } : {}),
      ...(input.postLogoutRedirectUris !== undefined ? {
        attributes: {
          ...(current.attributes ?? {}),
          [POST_LOGOUT_REDIRECT_ATTRIBUTE]: postLogoutRedirectAttribute(input.postLogoutRedirectUris) ?? "",
        },
      } : {}),
      ...(input.webOrigins !== undefined ? { webOrigins: input.webOrigins } : {}),
    };
    const savedClient = await updateKeycloakClient(auth.ctx.accessToken, current, clientPatch);
    const savedMetadata = metadata ? await updateClientMetadata(current.id, {
      ...(input.name !== undefined ? { displayName: input.name ?? null } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.businessOwner !== undefined ? { businessOwner: input.businessOwner ?? null } : {}),
      ...(input.technicalOwner !== undefined ? { technicalOwner: input.technicalOwner ?? null } : {}),
      ...(input.primaryContactEmail !== undefined ? { primaryContactEmail: input.primaryContactEmail ?? null } : {}),
      ...(input.secondaryContactEmail !== undefined ? { secondaryContactEmail: input.secondaryContactEmail ?? null } : {}),
      ...(input.supportContact !== undefined ? { supportContact: input.supportContact ?? null } : {}),
    }) : null;
    await logAdminAction(auth.ctx, "CLIENT_CONFIGURATION_UPDATED", undefined, {
      clientId: current.clientId, keycloakClientUuid: current.id, fields: Object.keys(input),
    });
    return NextResponse.json({ client: savedClient ? publicClientRepresentation(savedClient) : null, metadata: savedMetadata, validation: findingSummary(clientSecurity(savedClient ?? current, template, environment)) });
  } catch (error) {
    return auditedErrorResponse(error, auth.ctx, "CLIENT_CONFIGURATION_UPDATED", undefined, { clientId: id });
  }
}
