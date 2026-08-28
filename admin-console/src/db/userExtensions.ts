import "server-only";
import { eq } from "drizzle-orm";
import { adminDatabase } from "./client";
import { userAdditionalContacts, userExtensions, type NewUserExtension } from "./schema";

export async function extensionForUser(keycloakUserId: string) {
  const db = adminDatabase();
  const [extension, contacts] = await Promise.all([
    db.query.userExtensions.findFirst({ where: eq(userExtensions.keycloakUserId, keycloakUserId) }),
    db.query.userAdditionalContacts.findMany({
      where: eq(userAdditionalContacts.keycloakUserId, keycloakUserId),
      orderBy: (contact, { asc }) => [asc(contact.kind), asc(contact.value)],
    }),
  ]);
  return { extension: extension ?? null, contacts };
}

export async function upsertUserExtension(values: NewUserExtension & { keycloakUserId: string }) {
  const [saved] = await adminDatabase()
    .insert(userExtensions)
    .values(values)
    .onConflictDoUpdate({
      target: userExtensions.keycloakUserId,
      set: {
        hrmsEmployeeId: values.hrmsEmployeeId,
        dateOfBirth: values.dateOfBirth,
        fatherName: values.fatherName,
        motherName: values.motherName,
        panLast5: values.panLast5,
        eofficeId: values.eofficeId,
        eduEmail: values.eduEmail,
        ehospitalId: values.ehospitalId,
        contentProviderEmail: values.contentProviderEmail,
        rollNumber: values.rollNumber,
        companyName: values.companyName,
        requestEofficeReceiptNumber: values.requestEofficeReceiptNumber,
        requestEofficeReceiptDate: values.requestEofficeReceiptDate,
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved;
}

export async function deleteUserExtension(keycloakUserId: string) {
  await adminDatabase().delete(userExtensions).where(eq(userExtensions.keycloakUserId, keycloakUserId));
}
