import "server-only";
import { USER_PROFILE_FIELDS } from "@/lib/userProfileFields";
import type { NewUserExtension } from "@/db/schema";
import type { HrmsEmployeeRecord, KeycloakProfileDraft } from "@/types/hrms";

const HONORIFICS = new Set(["DR", "MR", "MRS", "MS", "MISS", "SH", "SHRI", "SMT"]);
const EMPLOYMENT_TYPES: Record<string, string> = {
  permanent: "Permanent",
  contract: "Contract",
  contractual: "Contract",
  research: "Research",
  student: "Student",
  deputed: "Deputed",
  outsourced: "Outsourced",
  vendor: "Vendor",
};

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts[0] && HONORIFICS.has(parts[0].replace(/\./g, "").toUpperCase())) parts.shift();
  if (parts.length < 2) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

function usernameSuggestion(email: string | null, employeeId: string): string {
  const source = email?.split("@")[0] || employeeId;
  return source.toLowerCase().replace(/[^a-z0-9._-]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  if (!match) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.indexOf(match[2].toLowerCase()) + 1;
  return month ? `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
}

export function mapHrmsToKeycloakDraft(hrms: HrmsEmployeeRecord): KeycloakProfileDraft {
  const warnings: string[] = [];
  const name = splitName(hrms.name);
  const attributes: Record<string, string[]> = { employee_id: [hrms.employeeId] };
  if (hrms.mobileNumber) attributes.phone_number = [hrms.mobileNumber];
  if (hrms.jobCategory) {
    const mapped = EMPLOYMENT_TYPES[hrms.jobCategory.trim().toLowerCase()];
    if (mapped) attributes.employment_type = [mapped];
    else warnings.push(`HRMS job category “${hrms.jobCategory}” is not mapped to a Keycloak employment type.`);
  }
  if (hrms.designation) {
    const field = USER_PROFILE_FIELDS.find((candidate) => candidate.name === "designation");
    if (field?.options?.includes(hrms.designation)) attributes.designation = [hrms.designation];
    else warnings.push(`HRMS designation “${hrms.designation}” is not an allowed Keycloak designation.`);
  }
  if (hrms.retirementDate) {
    const retirementDate = isoDate(hrms.retirementDate);
    if (retirementDate) attributes.account_expiry_date = [retirementDate];
    else warnings.push(`HRMS retirement date “${hrms.retirementDate}” could not be converted to YYYY-MM-DD.`);
  }
  if (!name.lastName) warnings.push("HRMS name could not be split into first and last name; review the draft.");
  return {
    username: usernameSuggestion(hrms.emailAddress, hrms.employeeId),
    email: hrms.emailAddress ?? "",
    firstName: name.firstName,
    lastName: name.lastName,
    attributes,
    warnings,
  };
}

export function extensionFromHrms(keycloakUserId: string, hrms: HrmsEmployeeRecord): NewUserExtension {
  return {
    keycloakUserId,
    hrmsEmployeeId: hrms.employeeId,
    dateOfBirth: isoDate(hrms.dateOfBirth),
    fatherName: hrms.fatherName,
    motherName: hrms.motherName,
    panLast5: hrms.panLast5,
  };
}
