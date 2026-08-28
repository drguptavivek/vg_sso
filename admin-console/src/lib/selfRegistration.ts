import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, count, eq, gt, gte } from "drizzle-orm";
import { adminDatabase } from "@/db/client";
import { selfRegistrationAttempts, type SelfRegistrationAttempt } from "@/db/schema";
import type { HrmsEmployeeRecord } from "@/types/hrms";

const DEFAULT_TOKEN_MINUTES = 10;
const DEFAULT_IP_LIMIT = 10;
const DEFAULT_EMPLOYEE_LIMIT = 5;
const RATE_WINDOW_MINUTES = 15;

export class RegistrationRateLimitError extends Error {}
export class RegistrationTokenError extends Error {}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function registrationSecret(): string {
  const value = process.env.SELF_REGISTRATION_SECRET?.trim();
  if (!value) throw new Error("Missing required environment variable: SELF_REGISTRATION_SECRET");
  return value;
}

export function normalizeEmployeeId(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizePhone(value: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

export function normalizeEmail(value: string | null): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : "Unavailable";
}

export function maskEmail(value: string): string {
  const [local, domain] = value.trim().split("@");
  if (!local || !domain) return "Unavailable";
  const tail = local.length > 1 ? local.slice(-Math.min(3, local.length - 1)) : "";
  return `${local[0]}•••${tail}@${domain}`;
}

export function hrmsFingerprint(hrms: HrmsEmployeeRecord): string {
  return sha256(JSON.stringify([
    normalizeEmployeeId(hrms.employeeId),
    hrms.name,
    hrms.fatherName,
    hrms.motherName,
    hrms.panLast5,
    hrms.dateOfBirth,
    hrms.dateOfJoining,
    hrms.retirementDate,
    hrms.department,
    hrms.designation,
    normalizeEmail(hrms.emailAddress),
    hrms.employeeGroup,
    hrms.establishment,
    hrms.jobCategory,
    normalizePhone(hrms.mobileNumber),
  ]));
}

function clientAddress(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
  return forwarded?.at(-1) || "unknown";
}

function privacyHash(kind: string, value: string): string {
  return createHmac("sha256", registrationSecret()).update(`${kind}:${value}`).digest("hex");
}

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function createRegistrationAttempt(
  employeeId: string,
  fingerprint: string,
  headers: Headers,
): Promise<{ token: string; expiresAt: Date }> {
  const normalizedEmployeeId = normalizeEmployeeId(employeeId);
  const employeeIdHash = privacyHash("employee", normalizedEmployeeId);
  const requestIpHash = privacyHash("ip", clientAddress(headers));
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000);
  const db = adminDatabase();

  const [[employeeRequests], [ipRequests]] = await Promise.all([
    db.select({ value: count() }).from(selfRegistrationAttempts).where(and(
      eq(selfRegistrationAttempts.employeeIdHash, employeeIdHash),
      gte(selfRegistrationAttempts.createdAt, since),
    )),
    db.select({ value: count() }).from(selfRegistrationAttempts).where(and(
      eq(selfRegistrationAttempts.requestIpHash, requestIpHash),
      gte(selfRegistrationAttempts.createdAt, since),
    )),
  ]);

  if (
    Number(employeeRequests?.value ?? 0) >= positiveInteger("SELF_REGISTRATION_EMPLOYEE_RATE_LIMIT", DEFAULT_EMPLOYEE_LIMIT)
    || Number(ipRequests?.value ?? 0) >= positiveInteger("SELF_REGISTRATION_IP_RATE_LIMIT", DEFAULT_IP_LIMIT)
  ) {
    throw new RegistrationRateLimitError("Too many registration attempts. Please try again later.");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + positiveInteger(
    "SELF_REGISTRATION_TOKEN_MINUTES",
    DEFAULT_TOKEN_MINUTES,
  ) * 60_000);

  await db.insert(selfRegistrationAttempts).values({
    employeeId: normalizedEmployeeId,
    employeeIdHash,
    requestIpHash,
    tokenHash: sha256(token),
    hrmsFingerprint: fingerprint,
    expiresAt,
  });

  return { token, expiresAt };
}

export async function claimRegistrationAttempt(token: string): Promise<SelfRegistrationAttempt> {
  const [attempt] = await adminDatabase()
    .update(selfRegistrationAttempts)
    .set({ status: "processing", updatedAt: new Date() })
    .where(and(
      eq(selfRegistrationAttempts.tokenHash, sha256(token)),
      eq(selfRegistrationAttempts.status, "pending"),
      gt(selfRegistrationAttempts.expiresAt, new Date()),
    ))
    .returning();

  if (!attempt) {
    throw new RegistrationTokenError("This registration confirmation has expired or was already used.");
  }
  return attempt;
}

export async function finishRegistrationAttempt(
  id: string,
  status: "completed" | "blocked" | "failed",
  resultCode: string,
  keycloakUserId?: string,
): Promise<void> {
  await adminDatabase()
    .update(selfRegistrationAttempts)
    .set({
      status,
      resultCode,
      keycloakUserId: keycloakUserId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(selfRegistrationAttempts.id, id));
}
