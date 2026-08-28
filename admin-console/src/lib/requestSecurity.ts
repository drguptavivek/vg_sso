import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Reject browser mutations that did not originate from this exact app origin. */
export function rejectCrossOriginMutation(req: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;

  const origin = req.headers.get("origin");
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(config.appUrl).origin;
  } catch {
    return NextResponse.json({ error: "Application origin is not configured" }, { status: 500 });
  }

  if (!origin || origin !== expectedOrigin) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  return null;
}
