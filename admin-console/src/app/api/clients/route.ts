import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { errorResponse } from "@/lib/http";
import { auditedErrorResponse, logAdminAction } from "@/lib/actionAudit";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { requireAnyRole } from "@/lib/session";
import type { KcClient, KcGroup, KcUser } from "@/types/keycloak";
import {
  createClientSchema,
  findingSummary,
  validateClientRequest,
  RESERVED_CLIENTS,
  publicClientRepresentation,
  type ClientTemplate,
} from "@/lib/clientManagement";
import {
  appRolesForClient,
  assignApplicationAdministrator,
  clientSecurity,
  createKeycloakClient,
  findClientByClientId,
} from "@/lib/clientManagementService";
import { createClientMetadata, listClientMetadata, updateClientMetadata } from "@/lib/clientManagementDb";
import { adminDatabase } from "@/db/client";
import { clientMetadata } from "@/db/schema";
import { eq } from "drizzle-orm";

interface ClientAuditRow extends KcClient {
  appRolesGroup: KcGroup | null;
  administrators: KcUser[];
  roleGroups: KcGroup[];
  roleGroupCount: number;
  metadata?: typeof clientMetadata.$inferSelect | null;
  security: ReturnType<typeof findingSummary>;
}

const EXCLUDED_CLIENTS = RESERVED_CLIENTS;

async function metadataRows() {
  try { return await listClientMetadata(); } catch { return []; }
}

export async function GET(req: NextRequest) {
  const auth = await requireAnyRole([config.clientManagerRole, config.userManagerRole], req);
  if (!auth.ok) return auth.response;
  const query = req.nextUrl.searchParams.get("search")?.trim().toLowerCase();

  try {
    const [{ data: clients }, metadata] = await Promise.all([
      kcAdminRequest<KcClient[]>(auth.ctx.accessToken, "/clients", {
        query: { first: 0, max: 1000, viewableOnly: true },
      }),
      metadataRows(),
    ]);
    const metadataById = new Map(metadata.map((row) => [row.keycloakClientUuid, row]));
    const visibleClients = (clients ?? [])
      .filter((client) => !EXCLUDED_CLIENTS.has(client.clientId))
      .filter((client) => !query || client.clientId.toLowerCase().includes(query) || (client.name ?? "").toLowerCase().includes(query))
      .sort((a, b) => a.clientId.localeCompare(b.clientId));

    const rows: ClientAuditRow[] = await Promise.all(visibleClients.map(async (client) => {
      const roles = await appRolesForClient(auth.ctx.accessToken, client.clientId);
      const metadataRow = metadataById.get(client.id) ?? null;
      return {
        ...publicClientRepresentation(client),
        appRolesGroup: roles.root,
        administrators: roles.administrators,
        roleGroups: roles.roleGroups,
        roleGroupCount: roles.roleGroups.length,
        metadata: metadataRow,
        security: findingSummary(clientSecurity(client, metadataRow?.applicationType as ClientTemplate | undefined, metadataRow?.environment)),
      };
    }));
    return NextResponse.json({ clients: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAnyRole([config.clientManagerRole], req);
  if (!auth.ok) return auth.response;

  const parsed = createClientSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid client request", details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  const findings = validateClientRequest(input);
  if (!findingSummary(findings).valid) return NextResponse.json({ error: "Client security validation failed", validation: findingSummary(findings) }, { status: 400 });

  let client: KcClient | null = null;
  try {
    const existing = await findClientByClientId(auth.ctx.accessToken, input.clientId);
    if (existing) return NextResponse.json({ error: "A client with this client ID already exists" }, { status: 409 });

    await logAdminAction(auth.ctx, "CLIENT_PROVISION_REQUESTED", undefined, { clientId: input.clientId, template: input.template, environment: input.environment });
    client = await createKeycloakClient(auth.ctx.accessToken, {
      clientId: input.clientId,
      name: input.name,
      description: input.description,
      template: input.template,
      redirectUris: input.redirectUris,
      postLogoutRedirectUris: input.postLogoutRedirectUris,
      webOrigins: input.webOrigins,
    });
    if (!client?.id) throw new Error("Keycloak created the client but did not return its identifier");

    await createClientMetadata({
      keycloakClientUuid: client.id,
      clientId: client.clientId,
      displayName: input.name ?? null,
      description: input.description ?? null,
      environment: input.environment,
      applicationType: input.template,
      businessOwner: input.businessOwner ?? null,
      technicalOwner: input.technicalOwner ?? null,
      primaryContactEmail: input.primaryContactEmail ?? null,
      secondaryContactEmail: input.secondaryContactEmail ?? null,
      supportContact: input.supportContact ?? null,
      justification: input.justification ?? null,
      status: "provisioning",
      createdBy: auth.ctx.userId,
      approvedBy: auth.ctx.isRealmAdmin ? auth.ctx.userId : null,
      onboardingPackVersion: null,
      roleApiStatus: "not_available",
    });
    const administratorId = input.initialAdministratorUserId ?? auth.ctx.userId;
    await assignApplicationAdministrator(auth.ctx.accessToken, input.clientId, administratorId);
    const activeMetadata = await updateClientMetadata(client.id, { status: "active" });
    await logAdminAction(auth.ctx, "CLIENT_CREATED", undefined, { clientId: client.clientId, keycloakClientUuid: client.id, template: input.template, environment: input.environment, initialAdministratorUserId: administratorId });
    await logAdminAction(auth.ctx, "CLIENT_ADMIN_ADDED", administratorId, { clientId: client.clientId, keycloakClientUuid: client.id });
    return NextResponse.json({ client: publicClientRepresentation(client), metadata: activeMetadata, validation: findingSummary(clientSecurity(client, input.template, input.environment)) }, { status: 201 });
  } catch (error) {
    if (client?.id) {
      try { await adminDatabase().update(clientMetadata).set({ status: "provisioning_failed", updatedAt: new Date() }).where(eq(clientMetadata.keycloakClientUuid, client.id)); } catch {}
    }
    return auditedErrorResponse(error, auth.ctx, "CLIENT_PROVISION_FAILED", undefined, { clientId: input.clientId });
  }
}
