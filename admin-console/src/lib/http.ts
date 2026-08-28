import { NextResponse } from "next/server";
import { KeycloakAdminError } from "./keycloakAdmin";
import { HrmsError } from "./hrms/client";

export function errorResponse(err: unknown) {
  if (err instanceof KeycloakAdminError) {
    return NextResponse.json({ error: err.body ?? err.message }, { status: err.status });
  }
  if (err instanceof HrmsError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: String(err) }, { status: 500 });
}
