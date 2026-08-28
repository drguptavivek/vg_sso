import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchHrmsEmployee, HrmsError } from "@/lib/hrms/client";
import {
  checkRegistrationLookupRateLimit,
  createRegistrationAttempt,
  hrmsFingerprint,
  isPermanentHrmsEmployee,
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizeEmployeeId,
  normalizePhone,
  RegistrationRateLimitError,
} from "@/lib/selfRegistration";
import { rejectCrossOriginMutation } from "@/lib/requestSecurity";

const requestSchema = z.object({
  employeeId: z.string().trim().min(1).max(64),
});

function noStore(body: object, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(req: NextRequest) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return noStore({ error: "A valid employee ID is required" }, { status: 400 });
  }

  try {
    const requestedEmployeeId = normalizeEmployeeId(parsed.data.employeeId);
    checkRegistrationLookupRateLimit(requestedEmployeeId, req.headers);
    const hrms = await fetchHrmsEmployee(requestedEmployeeId);
    if (normalizeEmployeeId(hrms.employeeId) !== requestedEmployeeId) {
      return noStore({ error: "The EHRMS record did not match the requested employee ID" }, { status: 409 });
    }
    if (!isPermanentHrmsEmployee(hrms)) {
      return noStore({
        error: "Self-registration is currently available only to permanent employees.",
      }, { status: 403 });
    }

    const email = normalizeEmail(hrms.emailAddress);
    const phone = normalizePhone(hrms.mobileNumber);
    if (!z.string().email().safeParse(email).success || phone.length < 10 || phone.length > 15) {
      return noStore({
        error: "Your EHRMS record does not contain a usable email address and mobile number. Please contact HR.",
      }, { status: 422 });
    }

    const attempt = await createRegistrationAttempt(
      requestedEmployeeId,
      hrmsFingerprint(hrms),
      req.headers,
    );
    return noStore({
      token: attempt.token,
      expiresAt: attempt.expiresAt.toISOString(),
      employeeId: requestedEmployeeId,
      maskedEmail: maskEmail(email),
      maskedPhone: maskPhone(phone),
    });
  } catch (error) {
    if (error instanceof RegistrationRateLimitError) {
      return noStore({ error: error.message }, { status: 429 });
    }
    if (error instanceof HrmsError) {
      const status = error.status === 404 ? 404 : 502;
      const message = status === 404
        ? "No eligible EHRMS employee record was found for that ID."
        : "EHRMS could not be reached. Please try again later.";
      return noStore({ error: message }, { status });
    }
    console.error("SELF_REGISTRATION_LOOKUP_FAILED", error);
    return noStore({ error: "Registration lookup failed. Please try again later." }, { status: 500 });
  }
}
