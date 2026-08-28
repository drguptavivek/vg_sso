import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { config } from "@/lib/config";
import { kcAdminRequest } from "@/lib/keycloakAdmin";
import { errorResponse } from "@/lib/http";
import { adminAccessForUser, hasRealmAdminAccess, mfaCredentialTypesForUser } from "@/lib/adminAccess";
import { USER_PROFILE_ATTRIBUTE_FIELDS, USER_PROFILE_FIELDS } from "@/lib/userProfileFields";
import { extensionForUser, upsertUserExtension } from "@/db/userExtensions";
import { recordAdminAction } from "@/db/actionLog";
import { fetchHrmsEmployee } from "@/lib/hrms/client";
import { extensionFromHrms } from "@/lib/hrms/mapping";
import type { KcUser } from "@/types/keycloak";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const [{ data }, { data: groups }, adminAccess, mfaCredentialTypes, extensionData] = await Promise.all([
      kcAdminRequest<KcUser>(auth.ctx.accessToken, `/users/${id}`),
      kcAdminRequest(auth.ctx.accessToken, `/users/${id}/groups`, {
        query: { max: 1000, briefRepresentation: true },
      }),
      adminAccessForUser(auth.ctx.accessToken, id),
      mfaCredentialTypesForUser(auth.ctx.accessToken, id),
      extensionForUser(id),
    ]);
    return NextResponse.json({
      user: data ? {
        ...data,
        adminAccess,
        mfaConfigured: mfaCredentialTypes.length > 0,
        mfaCredentialTypes,
      } : data,
      groups: groups ?? [],
      ...extensionData,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(config.userManagerRole, req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as {
    enabled?: boolean;
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    attributes?: Record<string, string[]>;
    hrmsEmployeeId?: string;
  };

  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const submittedAttributes = body.attributes ?? {};
  const unsupported = Object.keys(submittedAttributes).filter(
    (name) => !USER_PROFILE_ATTRIBUTE_FIELDS.has(name),
  );
  if (unsupported.length > 0) {
    return NextResponse.json(
      { error: `Unsupported user attributes: ${unsupported.join(", ")}` },
      { status: 400 },
    );
  }

  for (const field of USER_PROFILE_FIELDS) {
    const values =
      field.source === "core"
        ? [String(body[field.name as keyof typeof body] ?? "")]
        : submittedAttributes[field.name];
    if (!values) continue;
    if (!field.multivalued && values.length > 1) {
      return NextResponse.json({ error: `${field.label} accepts only one value` }, { status: 400 });
    }
    for (const value of values) {
      if (field.maxLength && value.length > field.maxLength) {
        return NextResponse.json(
          { error: `${field.label} must be at most ${field.maxLength} characters` },
          { status: 400 },
        );
      }
      if (value && field.pattern && !new RegExp(field.pattern).test(value)) {
        return NextResponse.json({ error: `Invalid value for ${field.label}` }, { status: 400 });
      }
      if (value && field.options && !field.options.includes(value)) {
        return NextResponse.json({ error: `Invalid option for ${field.label}` }, { status: 400 });
      }
    }
  }

  let hrms = null;
  if (body.hrmsEmployeeId) {
    try {
      hrms = await fetchHrmsEmployee(body.hrmsEmployeeId.trim());
    } catch (err) {
      return errorResponse(err);
    }
  }

  try {
    const { data: current } = await kcAdminRequest<KcUser>(auth.ctx.accessToken, `/users/${id}`);
    if (!current) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (body.enabled === false) {
      if (id === auth.ctx.userId) {
        return NextResponse.json({ error: "You cannot disable your own account" }, { status: 403 });
      }
      if (!auth.ctx.isRealmAdmin && await hasRealmAdminAccess(auth.ctx.accessToken, id)) {
        return NextResponse.json(
          { error: "Only a realm administrator may disable another realm administrator" },
          { status: 403 },
        );
      }
    }

    const attributes = { ...(current.attributes ?? {}) };
    for (const [name, rawValues] of Object.entries(submittedAttributes)) {
      const values = rawValues.map((value) => value.trim()).filter(Boolean);
      if (values.length > 0) attributes[name] = values;
      else delete attributes[name];
    }

    const oldPhone = current.attributes?.phone_number?.[0] ?? "";
    const newPhone = attributes.phone_number?.[0] ?? "";
    if (oldPhone !== newPhone) {
      attributes.phone_verified = ["false"];
      delete attributes.phone_verified_at;
    }

    const merged: KcUser = {
      ...current,
      enabled: body.enabled ?? current.enabled,
      username: body.username ?? current.username,
      firstName: body.firstName ?? current.firstName,
      lastName: body.lastName ?? current.lastName,
      email: body.email ?? current.email,
      attributes,
    };

    await kcAdminRequest(auth.ctx.accessToken, `/users/${id}`, {
      method: "PUT",
      body: merged,
    });

    if (hrms) await upsertUserExtension(extensionFromHrms(id, hrms));
    await recordAdminAction({
      actorUserId: auth.ctx.userId,
      actorUsername: auth.ctx.username,
      targetUserId: id,
      action: body.enabled === undefined ? "user.profile.update" : "user.status.update",
      outcome: "success",
      summary: {
        username: merged.username,
        hrmsAttached: Boolean(hrms),
        fields: [...Object.keys(submittedAttributes), ...Object.keys(body).filter((key) => key !== "attributes" && key !== "hrmsEmployeeId")],
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
