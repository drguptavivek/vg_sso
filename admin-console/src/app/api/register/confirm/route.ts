import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { upsertUserExtension } from "@/db/userExtensions";
import { fetchHrmsEmployee, HrmsError } from "@/lib/hrms/client";
import { extensionFromHrms, mapHrmsToKeycloakDraft } from "@/lib/hrms/mapping";
import {
  chooseRegistrationUsername,
  createRegisteredUser,
  deleteRegisteredUser,
  findRegistrationConflict,
  RegistrationKeycloakError,
  type RegistrationConflict,
} from "@/lib/registrationKeycloak";
import {
  claimRegistrationAttempt,
  finishRegistrationAttempt,
  hrmsFingerprint,
  isPermanentHrmsEmployee,
  normalizeEmail,
  normalizePhone,
  RegistrationTokenError,
} from "@/lib/selfRegistration";
import { rejectCrossOriginMutation } from "@/lib/requestSecurity";

const requestSchema = z.object({
  token: z.string().trim().min(32).max(256),
});

const conflictResponses: Record<RegistrationConflict, { code: string; message: string }> = {
  email: {
    code: "EMAIL_ALREADY_REGISTERED",
    message: "An SSO account is already registered with this email address. Please sign in or reset your credentials.",
  },
  phone: {
    code: "PHONE_ALREADY_REGISTERED",
    message: "This mobile number is already registered in SSO. Please sign in or reset your credentials.",
  },
  employee: {
    code: "EMPLOYEE_ALREADY_REGISTERED",
    message: "An SSO account is already registered for this employee ID. Please sign in or reset your credentials.",
  },
};

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
    return noStore({ error: "A valid registration confirmation is required" }, { status: 400 });
  }

  let attempt;
  try {
    attempt = await claimRegistrationAttempt(parsed.data.token);
  } catch (error) {
    if (error instanceof RegistrationTokenError) {
      return noStore({ error: error.message, code: "CONFIRMATION_EXPIRED" }, { status: 410 });
    }
    console.error("SELF_REGISTRATION_CLAIM_FAILED", error);
    return noStore({ error: "Registration could not be confirmed" }, { status: 500 });
  }

  let createdUserId: string | undefined;
  try {
    const hrms = await fetchHrmsEmployee(attempt.employeeId);
    if (!isPermanentHrmsEmployee(hrms)) {
      await finishRegistrationAttempt(attempt.id, "blocked", "NOT_PERMANENT_EMPLOYEE");
      return noStore({
        error: "Self-registration is currently available only to permanent employees.",
        code: "NOT_PERMANENT_EMPLOYEE",
      }, { status: 403 });
    }
    if (hrmsFingerprint(hrms) !== attempt.hrmsFingerprint) {
      await finishRegistrationAttempt(attempt.id, "failed", "HRMS_RECORD_CHANGED");
      return noStore({
        error: "Your EHRMS record changed after lookup. Please start registration again.",
        code: "HRMS_RECORD_CHANGED",
      }, { status: 409 });
    }

    const email = normalizeEmail(hrms.emailAddress);
    const phone = normalizePhone(hrms.mobileNumber);
    if (!email || phone.length < 10 || phone.length > 15) {
      await finishRegistrationAttempt(attempt.id, "failed", "HRMS_CONTACT_INVALID");
      return noStore({
        error: "Your EHRMS contact details are incomplete. Please contact HR.",
        code: "HRMS_CONTACT_INVALID",
      }, { status: 422 });
    }

    const conflict = await findRegistrationConflict({
      email,
      phone,
      employeeId: attempt.employeeId,
    });
    if (conflict) {
      const response = conflictResponses[conflict];
      await finishRegistrationAttempt(attempt.id, "blocked", response.code);
      return noStore({ error: response.message, code: response.code }, { status: 409 });
    }

    const draft = mapHrmsToKeycloakDraft(hrms);
    draft.email = email;
    draft.attributes.phone_number = [phone];
    const username = await chooseRegistrationUsername(draft, attempt.employeeId);
    createdUserId = await createRegisteredUser({ draft, username });

    try {
      await upsertUserExtension(extensionFromHrms(createdUserId, hrms));
    } catch (error) {
      try {
        await deleteRegisteredUser(createdUserId);
      } catch (cleanupError) {
        console.error("SELF_REGISTRATION_COMPENSATING_DELETE_FAILED", {
          userId: createdUserId,
          error: cleanupError,
        });
      }
      createdUserId = undefined;
      throw error;
    }

    await finishRegistrationAttempt(attempt.id, "completed", "ACCOUNT_CREATED", createdUserId);
    return noStore({
      ok: true,
      code: "ACCOUNT_CREATED",
      username,
      message: "Your SSO account has been created. Check your EHRMS email for the verification and account-setup link.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof RegistrationKeycloakError && error.status === 409) {
      await finishRegistrationAttempt(attempt.id, "blocked", "ACCOUNT_DATA_ALREADY_REGISTERED");
      return noStore({
        error: "An SSO account is already registered with these details. Please sign in or reset your credentials.",
        code: "ACCOUNT_DATA_ALREADY_REGISTERED",
      }, { status: 409 });
    }
    await finishRegistrationAttempt(attempt.id, "failed", "REGISTRATION_FAILED", createdUserId);
    if (error instanceof HrmsError) {
      return noStore({ error: "EHRMS could not be reached. Please start again later." }, { status: 502 });
    }
    console.error("SELF_REGISTRATION_CONFIRM_FAILED", error);
    return noStore({ error: "Your account could not be created. Please try again later." }, { status: 502 });
  }
}
