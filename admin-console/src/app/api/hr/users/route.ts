import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest, KeycloakAdminError } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { enrichUsersWithAdminAccess } from "@/lib/adminAccess";
import { USER_PROFILE_ATTRIBUTE_FIELDS, USER_PROFILE_FIELDS } from "@/lib/userProfileFields";
import { fetchHrmsEmployee } from "@/lib/hrms/client";
import { extensionFromHrms } from "@/lib/hrms/mapping";
import { upsertUserExtension } from "@/db/userExtensions";
import { recordAdminAction } from "@/db/actionLog";
import type { CreateUserRequest, KcGroup, KcUser } from "@/types/keycloak";

type Query = Record<string, string | number | boolean | undefined>;

async function fetchAllUsers(accessToken: string, query: Query): Promise<KcUser[]> {
  const users: KcUser[] = [];
  const batchSize = 250;
  for (let first = 0; ; first += batchSize) {
    const { data } = await kcAdminRequest<KcUser[]>(accessToken, "/users", {
      query: { ...query, first, max: batchSize, briefRepresentation: false },
    });
    const batch = data ?? [];
    users.push(...batch);
    if (batch.length < batchSize) return users;
  }
}

async function fetchAllGroupMembers(accessToken: string, groupId: string): Promise<KcUser[]> {
  const users: KcUser[] = [];
  const batchSize = 250;
  for (let first = 0; ; first += batchSize) {
    const { data } = await kcAdminRequest<KcUser[]>(
      accessToken,
      `/groups/${encodeURIComponent(groupId)}/members`,
      { query: { first, max: batchSize, briefRepresentation: false } },
    );
    const batch = data ?? [];
    users.push(...batch);
    if (batch.length < batchSize) return users;
  }
}

async function fetchRealmRoleMembers(accessToken: string, roleName: string): Promise<KcUser[]> {
  const users: KcUser[] = [];
  const batchSize = 250;
  for (let first = 0; ; first += batchSize) {
    const { data } = await kcAdminRequest<KcUser[]>(
      accessToken,
      `/roles/${encodeURIComponent(roleName)}/users`,
      { query: { first, max: batchSize, briefRepresentation: false } },
    );
    const batch = data ?? [];
    users.push(...batch);
    if (batch.length < batchSize) return users;
  }
}

async function fetchAppAdminMembers(accessToken: string): Promise<KcUser[]> {
  const { data: roots } = await kcAdminRequest<KcGroup[]>(accessToken, "/groups", {
    query: { search: "AppRoles", exact: true, max: 20, briefRepresentation: true },
  });
  const appRoles = (roots ?? []).find((group) => group.path === "/AppRoles");
  if (!appRoles) return [];
  const { data: applications } = await kcAdminRequest<KcGroup[]>(
    accessToken,
    `/groups/${appRoles.id}/children`,
    { query: { first: 0, max: 1000, briefRepresentation: true } },
  );
  const members = await Promise.all(
    (applications ?? []).map((application) => fetchAllGroupMembers(accessToken, application.id)),
  );
  return Array.from(new Map(members.flat().map((user) => [user.id, user])).values());
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const rawSearch = req.nextUrl.searchParams.get("search")?.trim();
  const searchTerm = rawSearch?.replace(/\*/g, "");
  const search = searchTerm ? "*" + searchTerm + "*" : undefined;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(5, Number(req.nextUrl.searchParams.get("pageSize") ?? "20") || 20));
  const first = (page - 1) * pageSize;
  const expiryFrom = req.nextUrl.searchParams.get("expiryFrom") ?? "";
  const expiryTo = req.nextUrl.searchParams.get("expiryTo") ?? "";
  const employeeId = req.nextUrl.searchParams.get("employeeId")?.trim() ?? "";
  const phoneVerified = req.nextUrl.searchParams.get("phoneVerified") ?? "";
  const enabledFilter = req.nextUrl.searchParams.get("enabled") ?? "";
  const groupId = req.nextUrl.searchParams.get("groupId") ?? "";
  const userTypeGroupId = req.nextUrl.searchParams.get("userTypeGroupId") ?? "";
  const adminAccessFilter = req.nextUrl.searchParams.get("adminAccess") ?? "";
  const enabled = enabledFilter === "true" ? true : enabledFilter === "false" ? false : undefined;
  const attributeQueries = [
    employeeId ? `employee_id:${employeeId}` : "",
    phoneVerified === "true" ? "phone_verified:true" : "",
  ].filter(Boolean);
  const nativeQuery: Query = {
    search,
    enabled,
    q: attributeQueries.length > 0 ? attributeQueries.join(" ") : undefined,
  };
  const groupIds = Array.from(new Set([groupId, userTypeGroupId].filter(Boolean)));
  const needsLocalFilter = Boolean(
    expiryFrom || expiryTo || phoneVerified === "false" || groupIds.length || adminAccessFilter,
  );

  try {
    if (!needsLocalFilter) {
      const [{ data: users }, { data: count }] = await Promise.all([
        kcAdminRequest<KcUser[]>(auth.ctx.accessToken, "/users", {
          query: { ...nativeQuery, first, max: pageSize, briefRepresentation: false },
        }),
        kcAdminRequest<number>(auth.ctx.accessToken, "/users/count", { query: nativeQuery }),
      ]);
      const enriched = await enrichUsersWithAdminAccess(auth.ctx.accessToken, users ?? []);
      return NextResponse.json({
        users: enriched,
        total: count ?? 0,
        page,
        pageSize,
      });
    }

    let matches: KcUser[];
    if (groupIds.length > 0) {
      matches = await fetchAllGroupMembers(auth.ctx.accessToken, groupIds[0]);
      for (const membershipGroupId of groupIds.slice(1)) {
        const members = await fetchAllGroupMembers(auth.ctx.accessToken, membershipGroupId);
        const memberIds = new Set(members.map((user) => user.id));
        matches = matches.filter((user) => memberIds.has(user.id));
      }
    } else if (adminAccessFilter === "client-manager" || adminAccessFilter === "user-manager") {
      matches = await fetchRealmRoleMembers(auth.ctx.accessToken, adminAccessFilter);
    } else if (adminAccessFilter === "app-admin") {
      matches = await fetchAppAdminMembers(auth.ctx.accessToken);
    } else {
      matches = await fetchAllUsers(auth.ctx.accessToken, nativeQuery);
    }

    const normalizedSearch = searchTerm?.toLocaleLowerCase();
    const normalizedEmployeeId = employeeId.toLocaleLowerCase();
    matches = matches.filter((user) => {
      if (normalizedSearch) {
        const searchable = [user.username, user.firstName, user.lastName, user.email]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        if (!searchable.includes(normalizedSearch)) return false;
      }
      if (enabled !== undefined && user.enabled !== enabled) return false;
      if (normalizedEmployeeId &&
          (user.attributes?.employee_id?.[0] ?? "").toLocaleLowerCase() !== normalizedEmployeeId) {
        return false;
      }
      if (phoneVerified === "true" && user.attributes?.phone_verified?.[0] !== "true") return false;
      if (phoneVerified === "false" && user.attributes?.phone_verified?.[0] === "true") return false;
      return true;
    });

    if (expiryFrom || expiryTo) {
      matches = matches.filter((user) => {
        const value = user.attributes?.account_expiry_date?.[0];
        return Boolean(value && (!expiryFrom || value >= expiryFrom) && (!expiryTo || value <= expiryTo));
      });
    }
    if (adminAccessFilter) {
      matches = await enrichUsersWithAdminAccess(auth.ctx.accessToken, matches);
      matches = matches.filter((user) => adminAccessFilter === "app-admin"
        ? user.adminAccess?.some((access) => access.startsWith("app-admin:"))
        : user.adminAccess?.includes(adminAccessFilter));
    }
    const pageUsers = await enrichUsersWithAdminAccess(
      auth.ctx.accessToken,
      matches.slice(first, first + pageSize),
    );
    return NextResponse.json({
      users: pageUsers,
      total: matches.length,
      page,
      pageSize,
    });
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
  for (const [name, rawValues] of Object.entries(body.attributes ?? {})) {
    if (!USER_PROFILE_ATTRIBUTE_FIELDS.has(name)) {
      return NextResponse.json({ error: `Unsupported user attribute: ${name}` }, { status: 400 });
    }
    const field = USER_PROFILE_FIELDS.find((candidate) => candidate.name === name);
    const values = rawValues.map((value) => value.trim()).filter(Boolean);
    if (!field?.multivalued && values.length > 1) {
      return NextResponse.json({ error: `${field?.label ?? name} accepts only one value` }, { status: 400 });
    }
    if (field?.options && values.some((value) => !field.options?.includes(value))) {
      return NextResponse.json({ error: `Invalid option for ${field.label}` }, { status: 400 });
    }
    if (values.length) attributes[name] = values;
  }
  if (body.phoneNumber) {
    attributes.phone_number = [body.phoneNumber];
  }
  if (attributes.phone_number?.length) attributes.phone_verified = ["false"];

  let hrms = null;
  if (body.hrmsEmployeeId) {
    try {
      hrms = await fetchHrmsEmployee(body.hrmsEmployeeId.trim());
    } catch (err) {
      return errorResponse(err);
    }
  }

  let createdUserId: string | undefined;
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
    createdUserId = userId;
    if (!userId) {
      return NextResponse.json({ error: "User created but id could not be determined" }, { status: 500 });
    }

    if (hrms) await upsertUserExtension(extensionFromHrms(userId, hrms));
    await recordAdminAction({
      actorUserId: auth.ctx.userId,
      actorUsername: auth.ctx.username,
      targetUserId: userId,
      action: "user.create",
      outcome: "success",
      summary: {
        username: body.username.trim(),
        hrmsAttached: Boolean(hrms),
        profileFields: ["username", "email", "firstName", "lastName", ...Object.keys(attributes)],
      },
    });

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
    if (createdUserId) {
      try {
        await kcAdminRequest(auth.ctx.accessToken, `/users/${createdUserId}`, { method: "DELETE" });
      } catch {
        // Preserve the original error; a failed compensating delete is visible in Keycloak events.
      }
    }
    return errorResponse(err);
  }
}
