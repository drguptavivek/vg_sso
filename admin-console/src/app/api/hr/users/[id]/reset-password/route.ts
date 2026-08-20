import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function generatePassword(): string {
  // 18 random bytes -> 24-char base64url string; readable enough to relay to a user once.
  return randomBytes(18).toString("base64url");
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    password?: string;
    temporary?: boolean;
    generate?: boolean;
  };

  const temporary = body.temporary ?? true;
  const generated = body.generate || !body.password;
  const password = generated ? generatePassword() : (body.password as string);

  try {
    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}/reset-password`, {
      method: "PUT",
      body: { type: "password", value: password, temporary },
    });

    return NextResponse.json({
      ok: true,
      temporary,
      // Only echo the password back when we generated it - it is never stored, and
      // this is the one moment the caller can retrieve it to relay to the user.
      generatedPassword: generated ? password : undefined,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
