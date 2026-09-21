import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { auditedErrorResponse } from "@/lib/actionAudit";
import {
  buildClientOnboardingManifest,
  isOnboardingFormat,
  onboardingArtifactMetadata,
  renderOnboardingArtifact,
  safeOnboardingFilename,
  type OnboardingFormat,
} from "@/lib/clientOnboarding";
import { requireRole } from "@/lib/session";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const CLIENT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestedFormat(request: NextRequest): OnboardingFormat | null {
  const value = request.nextUrl.searchParams.get("format") ?? "json";
  return isOnboardingFormat(value) ? value : null;
}

/**
 * Returns a configuration-specific, non-secret onboarding artifact for a
 * Keycloak client UUID. Generation is read-only, so this is intentionally a
 * GET endpoint (there is no email or credential-delivery side effect). The
 * default JSON response is suitable for preview; add ?download=1 for a
 * browser download, or use one of the format values directly from a link.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.clientManagerRole, request);
  if (!auth.ok) return auth.response;

  const format = requestedFormat(request);
  if (!format) {
    return NextResponse.json(
      { error: "Unsupported format. Use markdown, json, env, or openapi." },
      { status: 400 },
    );
  }

  const { id } = await params;
  if (!CLIENT_UUID_RE.test(id)) {
    return NextResponse.json({ error: "A valid Keycloak client UUID is required" }, { status: 400 });
  }

  try {
    const manifest = await buildClientOnboardingManifest(auth.ctx.accessToken, id);
    const content = renderOnboardingArtifact(manifest, format);
    const metadata = onboardingArtifactMetadata(format);
    const download = request.nextUrl.searchParams.get("download");
    const shouldDownload = download === "1" || download === "true" || (download === null && request.nextUrl.searchParams.has("format"));
    const response = new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": metadata.contentType,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="${safeOnboardingFilename(manifest.client.clientId, format)}"`,
      },
    });
    return response;
  } catch (error) {
    return auditedErrorResponse(error, auth.ctx, "client.onboarding-pack.generate", undefined, { clientUuid: id, format });
  }
}
