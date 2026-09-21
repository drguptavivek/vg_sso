import "server-only";
import { eq } from "drizzle-orm";
import { adminDatabase } from "@/db/client";
import { clientMetadata, type NewClientMetadata } from "@/db/schema";

export async function listClientMetadata() {
  return adminDatabase().query.clientMetadata.findMany({
    orderBy: (table, { asc }) => [asc(table.clientId)],
  });
}

export async function metadataForClient(keycloakClientUuid: string) {
  return adminDatabase().query.clientMetadata.findFirst({
    where: eq(clientMetadata.keycloakClientUuid, keycloakClientUuid),
  });
}

export async function metadataForClientId(clientId: string) {
  return adminDatabase().query.clientMetadata.findFirst({
    where: eq(clientMetadata.clientId, clientId),
  });
}

export async function createClientMetadata(values: NewClientMetadata) {
  const [saved] = await adminDatabase().insert(clientMetadata).values(values).returning();
  return saved;
}

export async function updateClientMetadata(
  keycloakClientUuid: string,
  values: Partial<NewClientMetadata>,
) {
  const [saved] = await adminDatabase()
    .update(clientMetadata)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(clientMetadata.keycloakClientUuid, keycloakClientUuid))
    .returning();
  return saved;
}
