import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";

interface RealmRepresentation {
  browserFlow?: string;
}

interface ExecutionInfo {
  providerId?: string;
  displayName?: string;
  requirement?: string;
  authenticationFlow?: boolean;
}

interface SecurityStatus {
  flow: string;
  smsOtpEnabled: boolean;
  smsOtpEnforced: boolean;
  smsRequirement?: string;
  mfaEnabled: boolean;
  mfaConditional: boolean;
  mfaRequirement?: string;
  checkedAt: string;
}

let cachedStatus: SecurityStatus | null = null;
let pendingStatus: Promise<SecurityStatus> | null = null;

function enabled(execution: ExecutionInfo | undefined): boolean {
  return Boolean(execution && execution.requirement !== "DISABLED");
}

async function inspectSecurityStatus(accessToken: string): Promise<SecurityStatus> {
  const { data: realm } = await kcAdminRequest<RealmRepresentation>(accessToken, "");
  const flow = realm?.browserFlow ?? "browser";
  const { data } = await kcAdminRequest<ExecutionInfo[]>(
    accessToken,
    `/authentication/flows/${encodeURIComponent(flow)}/executions`,
  );
  const executions = data ?? [];
  const sms = executions.find((execution) => execution.providerId === "phone-otp-authenticator");
  const otp = executions.find((execution) => execution.providerId === "auth-otp-form");
  const conditionalMfa = executions.find((execution) =>
    execution.authenticationFlow === true &&
    execution.displayName?.toLocaleLowerCase().includes("2fa"),
  );
  return {
    flow,
    smsOtpEnabled: enabled(sms),
    smsOtpEnforced: enabled(sms) && sms?.requirement === "REQUIRED",
    smsRequirement: sms?.requirement,
    mfaEnabled: enabled(otp),
    mfaConditional: enabled(otp) && conditionalMfa?.requirement === "CONDITIONAL",
    mfaRequirement: otp?.requirement,
    checkedAt: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const refresh = req.nextUrl.searchParams.get("refresh") === "true";
  if (cachedStatus && !refresh) {
    return NextResponse.json({ available: true, cached: true, ...cachedStatus });
  }

  try {
    if (!pendingStatus) pendingStatus = inspectSecurityStatus(auth.ctx.accessToken);
    cachedStatus = await pendingStatus;
    return NextResponse.json({ available: true, cached: false, ...cachedStatus });
  } catch (err) {
    const response = errorResponse(err);
    if (response.status === 403) {
      return NextResponse.json({
        available: false,
        error: "This account cannot inspect realm authentication flows.",
      });
    }
    return response;
  } finally {
    pendingStatus = null;
  }
}
