import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest, KeycloakAdminError } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import type { CreateUserRequest, KcUser } from "@/types/keycloak";

export async function GET(req: NextRequest) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const rawSearch = req.nextUrl.searchParams.get("search")?.trim();
  const searchTerm = rawSearch?.replace(/\*/g, "");
  const search = searchTerm ? "*" + searchTerm + "*" : undefined;
  const max = req.nextUrl.searchParams.get("max") ?? "50";

  try {
    const requests = [
      kcAdminRequest<KcUser[]>(auth.ctx.accessToken, "/users", {
        query: { search, max, briefRepresentation: "true" },
      }),
    ];
    if (searchTerm) {
      requests.push(
        kcAdminRequest<KcUser[]>(auth.ctx.accessToken, "/users", {
          query: { email: searchTerm, exact: "false", max, briefRepresentation: "true" },
        }),
      );
    }
    const results = await Promise.all(requests);
    const users = Array.from(
      new Map(results.flatMap((result) => result.data ?? []).map((user) => [user.id, user])).values(),
    ).slice(0, Number(max));
    return NextResponse.json({ users });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as CreateUserRequest;
  if (!body.username || body.username.trim() === "") {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const attributes: Record<string, string[]> = {};
  if (body.phoneNumber) {
    attributes.phone_number = [body.phoneNumber];
  }

  try {
    const { location } = await kcAdminRequest(auth.ctx.accessToken, "/users", {
      method: "POST",
      body: {
        username: body.username.trim(),
        email: body.email || undefined,
        firstName: body.firstName || undefined,
        lastName: body.lastName || undefined,
        enabled: true,
        emailVerified: false,
        attributes: Object.keys(attributes).length ? attributes : undefined,
        groups: body.groupPaths && body.groupPaths.length ? body.groupPaths : undefined,
      },
    });

    const userId = location ? location.split("/").filter(Boolean).pop() : undefined;
    if (!userId) {
      return NextResponse.json({ error: "User created but id could not be determined" }, { status: 500 });
    }

    let onboardingSent = false;
    let onboardingError: string | undefined;
    if (body.sendOnboarding !== false && body.email) {
      try {
        await kcAdminRequest(auth.ctx.accessToken, `/users/${userId}/execute-actions-email`, {
          method: "PUT",
          query: { lifespan: config.onboardingLifespanSeconds },
          body: config.onboardingActions,
        });
        onboardingSent = true;
      } catch (err) {
        onboardingError = err instanceof KeycloakAdminError ? JSON.stringify(err.body) : String(err);
      }
    }

    return NextResponse.json({ id: userId, onboardingSent, onboardingError }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
