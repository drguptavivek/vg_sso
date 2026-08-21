import { NextResponse } from "next/server";
import { KeycloakAdminError } from "./keycloakAdmin";

export function errorResponse(err: unknown) {
  if (err instanceof KeycloakAdminError) {
    return NextResponse.json({ error: err.body ?? err.message }, { status: err.status });
  }
  return NextResponse.json({ error: String(err) }, { status: 500 });
}
