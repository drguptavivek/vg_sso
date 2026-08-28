import {
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const contactKind = pgEnum("contact_kind", ["email", "phone"]);
export const contactPurpose = pgEnum("contact_purpose", ["alternate", "official", "emergency", "other"]);
export const actionOutcome = pgEnum("admin_action_outcome", ["success", "failure"]);
export const selfRegistrationStatus = pgEnum("self_registration_status", ["pending", "processing", "completed", "blocked", "failed"]);

export const userExtensions = pgTable("user_extensions", {
  keycloakUserId: uuid("keycloak_user_id").primaryKey(),
  hrmsEmployeeId: varchar("hrms_employee_id", { length: 64 }).unique(),
  dateOfBirth: date("date_of_birth"),
  fatherName: varchar("father_name", { length: 255 }),
  motherName: varchar("mother_name", { length: 255 }),
  panLast5: varchar("pan_last5", { length: 5 }),
  eofficeId: varchar("eoffice_id", { length: 128 }),
  eduEmail: varchar("edu_email", { length: 320 }),
  ehospitalId: varchar("ehospital_id", { length: 128 }),
  contentProviderEmail: varchar("content_provider_email", { length: 320 }),
  rollNumber: varchar("roll_number", { length: 128 }),
  companyName: varchar("company_name", { length: 255 }),
  requestEofficeReceiptNumber: varchar("request_eoffice_receipt_number", { length: 128 }),
  requestEofficeReceiptDate: date("request_eoffice_receipt_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("user_extensions_hrms_employee_idx").on(table.hrmsEmployeeId)]);

export const userAdditionalContacts = pgTable("user_additional_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  keycloakUserId: uuid("keycloak_user_id")
    .notNull()
    .references(() => userExtensions.keycloakUserId, { onDelete: "cascade" }),
  kind: contactKind("kind").notNull(),
  purpose: contactPurpose("purpose").notNull().default("alternate"),
  value: varchar("value", { length: 320 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("user_additional_contacts_user_kind_value_uidx")
    .on(table.keycloakUserId, table.kind, table.value),
  index("user_additional_contacts_user_idx").on(table.keycloakUserId),
]);

export const adminActionLogs = pgTable("admin_action_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid("actor_user_id").notNull(),
  actorUsername: varchar("actor_username", { length: 255 }),
  targetUserId: uuid("target_user_id"),
  action: varchar("action", { length: 128 }).notNull(),
  outcome: actionOutcome("outcome").notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
}, (table) => [
  index("admin_action_logs_occurred_idx").on(table.occurredAt),
  index("admin_action_logs_actor_idx").on(table.actorUserId),
  index("admin_action_logs_target_idx").on(table.targetUserId),
]);

export const selfRegistrationAttempts = pgTable("self_registration_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  employeeIdHash: varchar("employee_id_hash", { length: 64 }).notNull(),
  requestIpHash: varchar("request_ip_hash", { length: 64 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  hrmsFingerprint: varchar("hrms_fingerprint", { length: 64 }).notNull(),
  status: selfRegistrationStatus("status").notNull().default("pending"),
  resultCode: varchar("result_code", { length: 64 }),
  keycloakUserId: uuid("keycloak_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("self_registration_attempts_employee_idx").on(table.employeeIdHash, table.createdAt),
  index("self_registration_attempts_ip_idx").on(table.requestIpHash, table.createdAt),
  index("self_registration_attempts_status_expiry_idx").on(table.status, table.expiresAt),
]);

export type UserExtension = typeof userExtensions.$inferSelect;
export type NewUserExtension = typeof userExtensions.$inferInsert;
export type UserAdditionalContact = typeof userAdditionalContacts.$inferSelect;
export type AdminActionLog = typeof adminActionLogs.$inferSelect;
export type SelfRegistrationAttempt = typeof selfRegistrationAttempts.$inferSelect;
