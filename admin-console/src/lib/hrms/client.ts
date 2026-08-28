import "server-only";
import { z } from "zod";
import type { HrmsEmployeeRecord } from "@/types/hrms";

const optionalText = z.union([z.string(), z.number()]).nullish();
const apiResponseSchema = z.object({
  code: z.number(),
  status: z.string(),
  message: z.string().optional(),
  data: z.object({
    date_of_birth: optionalText,
    date_of_joining: optionalText,
    department: optionalText,
    designation: optionalText,
    email_address: optionalText,
    employee_group: optionalText,
    employee_id: optionalText,
    establishment: optionalText,
    father_name: optionalText,
    job_category: optionalText,
    mobile_number: optionalText,
    mother_name: optionalText,
    name: optionalText,
    pan_number: optionalText,
    retirement_date: optionalText,
  }).passthrough().optional(),
}).passthrough();

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function panLast5(value: unknown): string | null {
  const normalized = text(value)?.replace(/\s+/g, "").toUpperCase();
  return normalized ? normalized.slice(-5) : null;
}

export class HrmsError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export async function fetchHrmsEmployee(employeeId: string): Promise<HrmsEmployeeRecord> {
  const url = process.env.HRMS_API_URL?.trim();
  const token = process.env.HRMS_API_TOKEN?.trim();
  if (!url || !token) throw new HrmsError("HRMS integration is not configured", 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.HRMS_API_TIMEOUT_MS ?? "10000"));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Role": process.env.HRMS_API_ROLE?.trim() || "user",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ request_id: employeeId }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new HrmsError(`HRMS request failed with status ${response.status}`);
    const parsed = apiResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new HrmsError("HRMS returned an invalid response");
    if (parsed.data.code !== 200 || parsed.data.status.toLowerCase() !== "success" || !parsed.data.data) {
      throw new HrmsError(parsed.data.message || "HRMS employee record was not found", 404);
    }
    const data = parsed.data.data;
    return {
      employeeId: text(data.employee_id) || employeeId,
      name: text(data.name) || "",
      fatherName: text(data.father_name),
      motherName: text(data.mother_name),
      panLast5: panLast5(data.pan_number),
      dateOfBirth: text(data.date_of_birth),
      dateOfJoining: text(data.date_of_joining),
      retirementDate: text(data.retirement_date),
      department: text(data.department),
      designation: text(data.designation),
      emailAddress: text(data.email_address),
      employeeGroup: text(data.employee_group),
      establishment: text(data.establishment),
      jobCategory: text(data.job_category),
      mobileNumber: text(data.mobile_number),
    };
  } catch (error) {
    if (error instanceof HrmsError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HrmsError("HRMS request timed out", 504);
    throw new HrmsError("HRMS request failed");
  } finally {
    clearTimeout(timeout);
  }
}
