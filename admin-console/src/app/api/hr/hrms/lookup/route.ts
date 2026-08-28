import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { fetchHrmsEmployee, HrmsError } from "@/lib/hrms/client";
import { mapHrmsToKeycloakDraft } from "@/lib/hrms/mapping";

const requestSchema = z.object({
  employeeId: z.string().trim().min(1).max(64),
});

export async function POST(req: NextRequest) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;
  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid employee ID is required" }, { status: 400 });
  }
  try {
    const hrms = await fetchHrmsEmployee(parsed.data.employeeId);
    return NextResponse.json({ hrms, draft: mapHrmsToKeycloakDraft(hrms) });
  } catch (error) {
    if (error instanceof HrmsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "HRMS lookup failed" }, { status: 502 });
  }
}
