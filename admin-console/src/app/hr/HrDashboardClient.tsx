"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import {
  Loader2, Phone, PhoneOff, Plus, RefreshCw, Search, ShieldCheck, ShieldX,
  SlidersHorizontal, UserRound,
} from "lucide-react";
import type { KcGroup, KcUser } from "@/types/keycloak";
import type { HrmsEmployeeRecord, HrmsLookupResult } from "@/types/hrms";
import {
  USER_PROFILE_FIELDS,
  supportedTimezones,
  type UserProfileField,
} from "@/lib/userProfileFields";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/SignOutButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    await signOut({ redirect: false });
    window.location.assign("/signin?callbackUrl=%2Fhr");
    return await new Promise<T>(() => undefined);
  }
  if (!res.ok) {
    const detail = typeof data.error === "string" ? data.error : JSON.stringify(data.error ?? data);
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data as T;
}

function errMsg(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function adminAccessLabel(access: string): string {
  if (access === "realm-admin") return "Realm Admin";
  if (access === "client-manager") return "Client Manager";
  if (access === "user-manager") return "User Manager";
  if (access.startsWith("app-admin:")) return `App Admin · ${access.slice("app-admin:".length)}`;
  return access;
}

function AdminAccessDots({ values }: { values: string[] }) {
  const indicators = [
    { label: "Realm Admin", active: values.includes("realm-admin"), color: "bg-violet-500" },
    { label: "User Manager", active: values.includes("user-manager"), color: "bg-blue-500" },
    { label: "Client Admin", active: values.includes("client-manager"), color: "bg-amber-500" },
    { label: "App Admin", active: values.some((access) => access.startsWith("app-admin:")), color: "bg-emerald-500" },
  ];
  const activeIndicators = indicators.filter((indicator) => indicator.active);
  if (activeIndicators.length === 0) return null;
  return (
    <div className="flex shrink-0 gap-1.5" aria-label="Administrative access">
      {activeIndicators.map((indicator) => (
        <span key={indicator.label}
          title={indicator.label}
          className={`h-2.5 w-2.5 rounded-full ${indicator.color}`}
        />
      ))}
    </div>
  );
}

function PhoneVerificationIndicator({ user }: { user: KcUser }) {
  const phone = user.attributes?.phone_number?.[0];
  const verified = phone && user.attributes?.phone_verified?.[0] === "true";
  return verified ? (
    <span title="Phone verified by OTP" className="text-emerald-600">
      <Phone className="h-3.5 w-3.5" aria-label="Phone verified" />
    </span>
  ) : (
    <span title={phone ? "Phone not verified by OTP" : "Mandatory phone number missing"} className="text-destructive">
      <PhoneOff className="h-3.5 w-3.5" aria-label={phone ? "Phone not verified" : "Phone missing"} />
    </span>
  );
}

function MfaCredentialIndicator({ user }: { user: KcUser }) {
  return user.mfaConfigured ? (
    <span title={`Saved MFA: ${user.mfaCredentialTypes?.join(", ") || "configured"}`} className="text-emerald-600">
      <ShieldCheck className="h-3.5 w-3.5" aria-label="Saved MFA credential" />
    </span>
  ) : (
    <span title="No saved MFA credential" className="text-destructive">
      <ShieldX className="h-3.5 w-3.5" aria-label="No saved MFA credential" />
    </span>
  );
}

interface BrowserSecurityStatus {
  available: boolean;
  cached?: boolean;
  flow?: string;
  smsOtpEnabled?: boolean;
  smsOtpEnforced?: boolean;
  smsRequirement?: string;
  mfaEnabled?: boolean;
  mfaConditional?: boolean;
  mfaRequirement?: string;
  checkedAt?: string;
  error?: string;
}

export default function HrDashboardClient({
  username,
  currentUserId,
  isRealmAdmin,
  showGroupsLink = false,
}: {
  username: string;
  currentUserId: string;
  isRealmAdmin: boolean;
  showGroupsLink?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<KcUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;
  const [selectedUser, setSelectedUser] = useState<KcUser | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [expiryFrom, setExpiryFrom] = useState("");
  const [expiryTo, setExpiryTo] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [phoneVerifiedFilter, setPhoneVerifiedFilter] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [userTypes, setUserTypes] = useState<KcGroup[]>([]);
  const [userTypeGroupId, setUserTypeGroupId] = useState("");
  const [adminAccessFilter, setAdminAccessFilter] = useState("");
  const [filterGroup, setFilterGroup] = useState<KcGroup | null>(null);
  const [filterGroupQuery, setFilterGroupQuery] = useState("");
  const [filterGroupResults, setFilterGroupResults] = useState<KcGroup[]>([]);
  const [securityStatus, setSecurityStatus] = useState<BrowserSecurityStatus | null>(null);
  const [refreshingSecurity, setRefreshingSecurity] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [editProfileFor, setEditProfileFor] = useState<KcUser | null>(null);
  const [resetPasswordFor, setResetPasswordFor] = useState<KcUser | null>(null);
  const [manageGroupsFor, setManageGroupsFor] = useState<KcUser | null>(null);

  const loadUsers = useCallback(async (q: string, requestedPage: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: q,
        page: String(requestedPage),
        pageSize: String(pageSize),
      });
      if (expiryFrom) params.set("expiryFrom", expiryFrom);
      if (expiryTo) params.set("expiryTo", expiryTo);
      if (employeeId.trim()) params.set("employeeId", employeeId.trim());
      if (phoneVerifiedFilter) params.set("phoneVerified", phoneVerifiedFilter);
      if (enabledFilter) params.set("enabled", enabledFilter);
      if (filterGroup) params.set("groupId", filterGroup.id);
      if (userTypeGroupId) params.set("userTypeGroupId", userTypeGroupId);
      if (adminAccessFilter) params.set("adminAccess", adminAccessFilter);
      const data = await api<{ users: KcUser[]; total: number }>(`/api/hr/users?${params}`);
      setUsers(data.users);
      setTotal(data.total);
      setSelectedUser((current) => current ?? data.users[0] ?? null);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [adminAccessFilter, employeeId, enabledFilter, expiryFrom, expiryTo, filterGroup, phoneVerifiedFilter, userTypeGroupId]);

  useEffect(() => {
    void api<{ groups: KcGroup[] }>("/api/hr/groups?rootPath=%2FUser%20Type")
      .then((data) => setUserTypes(data.groups))
      .catch(() => setUserTypes([]));
  }, []);

  const loadSecurityStatus = useCallback(async (refresh = false) => {
    setRefreshingSecurity(true);
    try {
      const status = await api<BrowserSecurityStatus>(
        `/api/hr/security-status${refresh ? "?refresh=true" : ""}`,
      );
      setSecurityStatus(status);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setRefreshingSecurity(false);
    }
  }, []);

  useEffect(() => {
    void loadSecurityStatus();
  }, [loadSecurityStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers(search, page);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadUsers, page, search]);

  const activeFilterCount = [
    expiryFrom || expiryTo,
    employeeId.trim(),
    phoneVerifiedFilter,
    enabledFilter,
    userTypeGroupId,
    adminAccessFilter,
    filterGroup?.id,
  ].filter(Boolean).length;

  const cannotDisable = useCallback((user: KcUser) => (
    user.id === currentUserId || (!isRealmAdmin && user.adminAccess?.includes("realm-admin") === true)
  ), [currentUserId, isRealmAdmin]);

  async function toggleEnabled(user: KcUser) {
    if (user.enabled && cannotDisable(user)) {
      toast.error(user.id === currentUserId
        ? "You cannot disable your own account."
        : "Only a realm administrator may disable another realm administrator.");
      return;
    }
    try {
      await api(`/api/hr/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !user.enabled }),
      });
      toast.success(`${user.username} ${!user.enabled ? "enabled" : "disabled"}.`);
      loadUsers(search, page);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function resendOnboarding(user: KcUser) {
    try {
      await api(`/api/hr/users/${user.id}/resend-onboarding`, { method: "POST", body: "{}" });
      toast.success(`Onboarding email queued for ${user.username}.`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function searchFilterGroups(query: string) {
    setFilterGroupQuery(query);
    if (!query.trim()) {
      setFilterGroupResults([]);
      return;
    }
    try {
      const data = await api<{ groups: KcGroup[] }>(`/api/hr/groups?search=${encodeURIComponent(query)}`);
      setFilterGroupResults(data.groups);
    } catch {
      setFilterGroupResults([]);
    }
  }

  async function runBatch(action: "enable" | "disable" | "onboarding") {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (action === "disable") {
      const protectedUser = users.find((user) => selectedIds.has(user.id) && cannotDisable(user));
      if (protectedUser) {
        toast.error(protectedUser.id === currentUserId
          ? "Your selection includes your own account, which you cannot disable."
          : "Your selection includes a realm administrator that only another realm administrator may disable.");
        return;
      }
    }
    const label = action === "enable" ? "enable" : action === "disable" ? "disable" : "resend onboarding to";
    if (!window.confirm(`Are you sure you want to ${label} ${ids.length} selected user${ids.length === 1 ? "" : "s"}?`)) {
      return;
    }
    try {
      await Promise.all(
        ids.map((id) =>
          action === "onboarding"
            ? api(`/api/hr/users/${id}/resend-onboarding`, { method: "POST", body: "{}" })
            : api(`/api/hr/users/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ enabled: action === "enable" }),
              }),
        ),
      );
      toast.success(
        `${action === "enable" ? "Enabled" : action === "disable" ? "Disabled" : "Queued onboarding for"} ${ids.length} user${ids.length === 1 ? "" : "s"}.`,
      );
      setSelectedIds(new Set());
      await loadUsers(search, page);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1920px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">HR User Management</h1>
          <p className="text-sm text-muted-foreground">Signed in as {username}</p>
        </div>
        <div className="flex items-center gap-3">
          {isRealmAdmin && <Button variant="outline" asChild>
            <a href="/audit">Audit log</a>
          </Button>}
          {showGroupsLink && (
            <Button variant="outline" asChild>
              <a href="/groups">Groups</a>
            </Button>
          )}
          <Button onClick={() => { setShowCreate(true); setEditProfileFor(null); }}>
            <Plus /> Create user
          </Button>
          <SignOutButton />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[520px_minmax(0,1fr)] lg:items-start">
        <Card className="lg:sticky lg:top-6">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Users</CardTitle>
                <CardDescription>{total} matching account{total === 1 ? "" : "s"}</CardDescription>
              </div>
              <Button
                size="sm"
                variant={showFilters ? "secondary" : "outline"}
                onClick={() => setShowFilters((current) => !current)}
                aria-expanded={showFilters}
              >
                <SlidersHorizontal className="h-4 w-4" /> Filters
                {activeFilterCount > 0 && <Badge variant="default">{activeFilterCount}</Badge>}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 px-4 pb-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search username, name, or email..."
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                className="h-9 pl-9"
              />
            </div>
            {showFilters && (
            <div className="grid gap-2 rounded-lg border bg-muted/20 p-2 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Account expiry between</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" aria-label="Expiry from" value={expiryFrom}
                    onChange={(event) => { setExpiryFrom(event.target.value); setPage(1); }} className="h-8 text-xs" />
                  <Input type="date" aria-label="Expiry to" value={expiryTo}
                    onChange={(event) => { setExpiryTo(event.target.value); setPage(1); }} className="h-8 text-xs" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Employee ID (exact)</Label>
                <Input value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setPage(1); }}
                  placeholder="Employee ID" className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">User Type</Label>
                <select value={userTypeGroupId}
                  onChange={(event) => { setUserTypeGroupId(event.target.value); setPage(1); }}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
                  <option value="">Any type</option>
                  {userTypes.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Administrative access</Label>
                <select value={adminAccessFilter}
                  onChange={(event) => { setAdminAccessFilter(event.target.value); setPage(1); }}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
                  <option value="">Any access</option>
                  <option value="realm-admin">Realm Admin</option>
                  <option value="client-manager">Client Manager</option>
                  <option value="user-manager">User Manager</option>
                  <option value="app-admin">App Admin (any application)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone verification</Label>
                <select
                  value={phoneVerifiedFilter}
                  onChange={(event) => { setPhoneVerifiedFilter(event.target.value); setPage(1); }}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">Any status</option>
                  <option value="true">Verified by OTP</option>
                  <option value="false">Not verified</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Account status</Label>
                <select
                  value={enabledFilter}
                  onChange={(event) => { setEnabledFilter(event.target.value); setPage(1); }}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">Any status</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
              <div className="relative space-y-1 sm:col-span-2">
                <Label className="text-xs">Group membership</Label>
                {filterGroup ? (
                  <div className="flex h-8 items-center justify-between rounded-md border bg-background px-2 text-xs">
                    <span className="truncate">{filterGroup.path}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => { setFilterGroup(null); setFilterGroupQuery(""); setPage(1); }}
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <>
                    <Input
                      value={filterGroupQuery}
                      onChange={(event) => searchFilterGroups(event.target.value)}
                      placeholder="Search for a group..."
                      className="h-8 text-xs"
                    />
                    {filterGroupResults.length > 0 && (
                      <div className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-md border bg-background p-1 shadow-lg">
                        {filterGroupResults.map((group) => (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => {
                              setFilterGroup(group);
                              setFilterGroupQuery("");
                              setFilterGroupResults([]);
                              setPage(1);
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                          >
                            {group.path}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-end justify-end sm:col-span-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setExpiryFrom("");
                    setExpiryTo("");
                    setEmployeeId("");
                    setPhoneVerifiedFilter("");
                    setEnabledFilter("");
                    setUserTypeGroupId("");
                    setAdminAccessFilter("");
                    setFilterGroup(null);
                    setFilterGroupQuery("");
                    setFilterGroupResults([]);
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </div>
            )}

            <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <Checkbox
                checked={users.length > 0 && users.every((listedUser) => selectedIds.has(listedUser.id))}
                onCheckedChange={(checked) => {
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    users.forEach((listedUser) => checked === true ? next.add(listedUser.id) : next.delete(listedUser.id));
                    return next;
                  });
                }}
                aria-label="Select all users on this page"
              />
              <span className="mr-auto text-xs text-muted-foreground">{selectedIds.size} selected</span>
              {selectedIds.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
              )}
              <Button size="sm" variant="outline" disabled={selectedIds.size === 0} onClick={() => runBatch("enable")}>Enable</Button>
              <Button size="sm" variant="outline" disabled={selectedIds.size === 0} onClick={() => runBatch("disable")}>Disable</Button>
              <Button size="sm" variant="outline" disabled={selectedIds.size === 0} onClick={() => runBatch("onboarding")}>
                Resend onboarding
              </Button>
            </div>
            <div className="max-h-[65vh] space-y-1 overflow-y-auto pr-1">
              {loading && (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading users...
                </div>
              )}
              {!loading && users.map((listedUser) => (
                <div
                  key={listedUser.id}
                  className={
                    "flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors " +
                    (!showCreate && selectedUser?.id === listedUser.id
                      ? "border-primary bg-primary/10"
                      : "hover:bg-accent")
                  }
                >
                  <Checkbox
                    checked={selectedIds.has(listedUser.id)}
                    onCheckedChange={(checked) => {
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        checked === true ? next.add(listedUser.id) : next.delete(listedUser.id);
                        return next;
                      });
                    }}
                    aria-label={`Select ${listedUser.username}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUser(listedUser);
                      setShowCreate(false);
                      setEditProfileFor(null);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm">
                          <span className="font-medium">
                            {[listedUser.firstName, listedUser.lastName].filter(Boolean).join(" ") || "No name"}
                          </span>
                          <span className="text-muted-foreground"> · {listedUser.username}</span>
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          <AdminAccessDots values={listedUser.adminAccess ?? []} />
                          <PhoneVerificationIndicator user={listedUser} />
                          <MfaCredentialIndicator user={listedUser} />
                          <Badge variant={listedUser.enabled ? "success" : "secondary"}
                            className="h-5 px-1.5 text-[10px]">
                            {listedUser.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                        <span className={`truncate ${listedUser.attributes?.phone_number?.[0] ? "" : "font-medium text-destructive"}`}>
                          {listedUser.attributes?.phone_number?.[0] || "Phone missing"}
                        </span>
                        <span>·</span>
                        <span className="min-w-0 truncate">{listedUser.email || "No email"}</span>
                      </div>
                    </div>
                  </button>
                </div>
              ))}
              {!loading && users.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                  <UserRound className="h-8 w-8 opacity-50" /> No users found.
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page * pageSize >= total || loading}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="min-w-0">
          {showCreate ? (
            <CreateUserPanel
              onCancel={() => setShowCreate(false)}
              onCreated={async (id) => {
                setShowCreate(false);
                await loadUsers(search, 1);
                const data = await api<{ user: KcUser }>(`/api/hr/users/${id}`);
                setSelectedUser(data.user);
                setPage(1);
              }}
            />
          ) : editProfileFor ? (
            <EditProfilePanel
              user={editProfileFor}
              onCancel={() => setEditProfileFor(null)}
              onUpdated={async () => {
                const data = await api<{ user: KcUser }>(`/api/hr/users/${editProfileFor.id}`);
                setSelectedUser(data.user);
                setEditProfileFor(null);
                await loadUsers(search, page);
              }}
            />
          ) : selectedUser ? (
            <UserProfilePanel
              user={selectedUser}
              onEdit={(detail) => setEditProfileFor(detail)}
              onToggleEnabled={toggleEnabled}
              onResetPassword={setResetPasswordFor}
              onResendOnboarding={resendOnboarding}
              onManageGroups={setManageGroupsFor}
              cannotDisable={cannotDisable(selectedUser)}
            />
          ) : (
            <Card>
              <CardContent className="flex min-h-[520px] flex-col items-center justify-center text-center text-muted-foreground">
                <UserRound className="mb-3 h-10 w-10 opacity-50" />
                <p>Select a user or create a new account.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="sticky bottom-2 z-30 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="text-xs font-medium">Browser authentication</span>
        {securityStatus?.available ? (
          <>
            <Badge variant="outline">{securityStatus.flow}</Badge>
            <Badge variant={securityStatus.smsOtpEnforced ? "success" : "destructive"}>
              SMS OTP {securityStatus.smsOtpEnforced ? "required" : securityStatus.smsOtpEnabled ? "enabled, not required" : "off"}
            </Badge>
            <Badge variant={securityStatus.mfaEnabled ? "success" : "destructive"}>
              MFA {securityStatus.mfaEnabled ? securityStatus.mfaConditional ? "on for enrolled users" : "on" : "off"}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {securityStatus.cached ? "Cached" : "Fresh"}
              {securityStatus.checkedAt ? ` · ${new Date(securityStatus.checkedAt).toLocaleTimeString()}` : ""}
            </span>
          </>
        ) : (
          <span className="text-xs text-destructive">
            {securityStatus?.error ?? "Checking authentication flow…"}
          </span>
        )}
        <Button size="sm" variant="outline" className="ml-auto h-7"
          disabled={refreshingSecurity} onClick={() => loadSecurityStatus(true)}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshingSecurity ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <ResetPasswordDialog user={resetPasswordFor} onOpenChange={(open) => !open && setResetPasswordFor(null)} />

      <ManageGroupsDialog user={manageGroupsFor} onOpenChange={(open) => !open && setManageGroupsFor(null)} />
    </div>
  );
}

function valuesForField(user: KcUser, field: UserProfileField): string[] {
  if (field.source === "attribute") {
    const values = user.attributes?.[field.name] ?? [];
    return values.length > 0 ? values : [""];
  }
  const coreValues: Record<string, string> = {
    username: user.username ?? "",
    email: user.email ?? "",
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
  };
  return [coreValues[field.name] ?? ""];
}

function UserProfilePanel({
  user,
  onEdit,
  onToggleEnabled,
  onResetPassword,
  onResendOnboarding,
  onManageGroups,
  cannotDisable,
}: {
  user: KcUser;
  onEdit: (user: KcUser) => void;
  onToggleEnabled: (user: KcUser) => void;
  onResetPassword: (user: KcUser) => void;
  onResendOnboarding: (user: KcUser) => void;
  onManageGroups: (user: KcUser) => void;
  cannotDisable: boolean;
}) {
  const [detail, setDetail] = useState<KcUser | null>(null);
  const [groups, setGroups] = useState<KcGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void api<{ user: KcUser; groups: KcGroup[] }>(`/api/hr/users/${user.id}`)
      .then((data) => {
        setDetail(data.user);
        setGroups(data.groups);
      })
      .catch((err) => toast.error(errMsg(err)))
      .finally(() => setLoading(false));
  }, [user]);

  const displayed = detail ?? user;
  const userTypeGroups = groups.filter((group) => group.path.startsWith("/User Type/"));
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{displayed.username}</CardTitle>
            <CardDescription>
              {[displayed.firstName, displayed.lastName].filter(Boolean).join(" ") || displayed.email || "User profile"}
            </CardDescription>
          </div>
          <Button onClick={() => onEdit(displayed)}>Edit profile</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Badge variant={displayed.enabled ? "success" : "secondary"}>
            {displayed.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <Button size="sm" variant="outline"
            disabled={displayed.enabled && cannotDisable}
            title={displayed.enabled && cannotDisable
              ? "Self-disable is blocked, and only realm administrators may disable another realm administrator."
              : undefined}
            onClick={() => onToggleEnabled(displayed)}>
            {displayed.enabled ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onResetPassword(displayed)}>Reset password</Button>
          <Button size="sm" variant="outline" onClick={() => onResendOnboarding(displayed)}>Resend onboarding</Button>
          <Button size="sm" variant="outline" onClick={() => onManageGroups(displayed)}>Manage groups</Button>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="mb-2 text-sm font-medium">Administrative access</p>
          <div className="flex flex-wrap gap-2">
            {displayed.adminAccess?.map((access) => (
              <Badge key={access} variant={access === "realm-admin" ? "default" : "outline"}>
                {adminAccessLabel(access)}
              </Badge>
            ))}
            {!displayed.adminAccess?.length && <span className="text-sm text-muted-foreground">No administrative access.</span>}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-primary/10 pt-3">
            {displayed.mfaConfigured ? (
              <Badge variant="success">Saved MFA credential</Badge>
            ) : (
              <Badge variant="destructive">No saved MFA credential</Badge>
            )}
            {displayed.mfaCredentialTypes?.length ? (
              <span className="text-xs text-muted-foreground">{displayed.mfaCredentialTypes.join(", ")}</span>
            ) : null}
          </div>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading profile...
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {USER_PROFILE_FIELDS.map((field) => {
                const fieldValues = valuesForField(displayed, field).filter(Boolean);
                return (
                  <div key={field.name} className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
                    {field.name === "phone_verified" ? (
                      <Badge className="mt-2" variant={fieldValues[0] === "true" ? "success" : "secondary"}>
                        {fieldValues[0] === "true" ? "Verified by OTP" : "Not verified"}
                      </Badge>
                    ) : fieldValues.length > 0 ? (
                      <div className="mt-1 space-y-1 text-sm">
                        {fieldValues.map((value, index) => <p key={index} className="break-words">{value}</p>)}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">Not set</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">User Type</p>
              <div className="flex flex-wrap gap-2">
                {userTypeGroups.map((group) => <Badge key={group.id}>{group.name}</Badge>)}
                {userTypeGroups.length === 0 && <span className="text-sm text-muted-foreground">Not assigned.</span>}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Group memberships</p>
              <div className="flex flex-wrap gap-2">
                {groups.map((group) => <Badge key={group.id} variant="outline">{group.path}</Badge>)}
                {groups.length === 0 && <span className="text-sm text-muted-foreground">No group memberships.</span>}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EditProfilePanel({
  user,
  onCancel,
  onUpdated,
}: {
  user: KcUser;
  onCancel: () => void;
  onUpdated: () => void;
}) {
  const [detail, setDetail] = useState<KcUser | null>(null);
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [hrmsEmployeeId, setHrmsEmployeeId] = useState("");
  const [hrmsWarnings, setHrmsWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) {
      setDetail(null);
      setValues({});
      return;
    }
    setLoading(true);
    void api<{ user: KcUser; extension?: { hrmsEmployeeId?: string | null } }>(`/api/hr/users/${user.id}`)
      .then((data) => {
        setDetail(data.user);
        setValues(
          Object.fromEntries(
            USER_PROFILE_FIELDS.map((field) => [field.name, valuesForField(data.user, field)]),
          ),
        );
        setHrmsEmployeeId(data.extension?.hrmsEmployeeId ?? data.user.attributes?.employee_id?.[0] ?? "");
        setHrmsWarnings([]);
      })
      .catch((err) => toast.error(errMsg(err)))
      .finally(() => setLoading(false));
  }, [user]);

  function setValue(name: string, index: number, value: string) {
    setValues((current) => {
      const next = [...(current[name] ?? [""])];
      next[index] = value;
      return { ...current, [name]: next };
    });
  }

  function addValue(name: string) {
    setValues((current) => ({ ...current, [name]: [...(current[name] ?? []), ""] }));
  }

  function removeValue(name: string, index: number) {
    setValues((current) => {
      const next = (current[name] ?? []).filter((_, valueIndex) => valueIndex !== index);
      return { ...current, [name]: next.length > 0 ? next : [""] };
    });
  }

  function applyHrmsDraft(result: HrmsLookupResult, selectedKeys: string[]) {
    const selected = new Set(selectedKeys);
    setValues((current) => {
      const next = { ...current };
      const coreValues: Record<string, string> = {
        email: result.draft.email,
        firstName: result.draft.firstName,
        lastName: result.draft.lastName,
      };
      for (const [name, value] of Object.entries(coreValues)) {
        if (selected.has(name)) next[name] = [value];
      }
      for (const [name, value] of Object.entries(result.draft.attributes)) {
        if (selected.has(name)) next[name] = value;
      }
      const remarks = [...(next.remarks ?? [])].filter(Boolean);
      for (const proposal of hrmsRemarkProposals(result.hrms)) {
        if (selected.has(proposal.key) && !remarks.includes(proposal.value)) remarks.push(proposal.value);
      }
      next.remarks = remarks.length ? remarks : [""];
      return next;
    });
    setHrmsEmployeeId(result.hrms.employeeId);
    setHrmsWarnings(result.draft.warnings);
  }

  async function submit() {
    if (!detail) return;
    for (const field of USER_PROFILE_FIELDS) {
      if (field.required && !(values[field.name]?.[0] ?? "").trim()) {
        toast.error(`${field.label} is required.`);
        return;
      }
    }

    const core = Object.fromEntries(
      USER_PROFILE_FIELDS
        .filter((field) => field.source === "core")
        .map((field) => [field.name, values[field.name]?.[0] ?? ""]),
    );
    const attributes = Object.fromEntries(
      USER_PROFILE_FIELDS
        .filter((field) => field.source === "attribute" && field.editable !== false)
        .map((field) => [field.name, values[field.name] ?? []]),
    );

    setSubmitting(true);
    try {
      await api(`/api/hr/users/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...core, attributes, hrmsEmployeeId: hrmsEmployeeId || undefined }),
      });
      toast.success(`Profile updated for ${core.username}.`);
      onUpdated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
          <CardTitle>Edit user profile: {detail?.username ?? user.username}</CardTitle>
          <CardDescription>
            Edit the user fields supported by this application. Phone verification is controlled only by OTP validation.
          </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading profile...
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {USER_PROFILE_FIELDS.map((field) => <ProfileFieldEditor key={field.name} field={field}
                  values={values[field.name] ?? [""]}
                  onChange={(index, value) => setValue(field.name, index, value)}
                  onAdd={() => addValue(field.name)} onRemove={(index) => removeValue(field.name, index)} />)}
              </div>
              {hrmsWarnings.length > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Review unmapped HRMS values</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {hrmsWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>}
            </div>
            <HrmsSourcePanel
              initialEmployeeId={hrmsEmployeeId}
              currentValues={values}
              includeUsername={false}
              onApply={applyHrmsDraft}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={loading || submitting || !detail}>
            {submitting && <Loader2 className="animate-spin" />}
            Save profile
          </Button>
        </DialogFooter>
      </CardContent>
    </Card>
  );
}

function ProfileFieldEditor({
  field,
  values,
  onChange,
  onAdd,
  onRemove,
}: {
  field: UserProfileField;
  values: string[];
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const fieldId = `profile-${field.name}`;
  const timezoneOptions = field.control === "timezone" ? supportedTimezones(values[0]) : [];

  if (field.editable === false) {
    const value = values.filter(Boolean).join(", ") || "false";
    return (
      <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
        <Label>{field.label}</Label>
        <div><Badge variant={value === "true" ? "success" : "secondary"}>{value}</Badge></div>
        {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
      </div>
    );
  }

  return (
    <div className={"space-y-1.5 " + (field.control === "textarea" ? "md:col-span-2" : "")}>
      <Label htmlFor={fieldId}>
        {field.label}{field.required ? " *" : ""}
      </Label>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {field.control === "select" ? (
                <select
                  id={index === 0 ? fieldId : undefined}
                  value={value}
                  onChange={(event) => onChange(index, event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select...</option>
                  {value && !field.options?.includes(value) && (
                    <option value={value}>{value} (current value)</option>
                  )}
                  {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : field.control === "textarea" ? (
                <textarea
                  id={index === 0 ? fieldId : undefined}
                  value={value}
                  onChange={(event) => onChange(index, event.target.value)}
                  maxLength={field.maxLength}
                  rows={4}
                  className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              ) : (
                <>
                  <Input
                    id={index === 0 ? fieldId : undefined}
                    type={field.control === "date" ? "date" : field.control === "email" ? "email" : "text"}
                    value={value}
                    onChange={(event) => onChange(index, event.target.value)}
                    maxLength={field.maxLength}
                    pattern={field.pattern}
                    placeholder={field.placeholder}
                    list={field.control === "timezone" ? `${fieldId}-options` : undefined}
                  />
                  {field.control === "timezone" && (
                    <datalist id={`${fieldId}-options`}>
                      {timezoneOptions.map((timezone) => <option key={timezone} value={timezone} />)}
                    </datalist>
                  )}
                </>
              )}
            </div>
            {field.multivalued && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(index)}>
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>
      {field.multivalued && (
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus /> Add value
        </Button>
      )}
      {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
    </div>
  );
}

const HRMS_DISPLAY_FIELDS: Array<[keyof HrmsEmployeeRecord, string]> = [
  ["employeeId", "Employee ID"], ["name", "Name"],
  ["fatherName", "Father’s name"], ["motherName", "Mother’s name"],
  ["panLast5", "PAN last five"], ["dateOfBirth", "Date of birth"],
  ["dateOfJoining", "Date of joining"], ["retirementDate", "Retirement date"],
  ["jobCategory", "Job category"], ["designation", "Designation"],
  ["department", "Department"], ["establishment", "Establishment"],
  ["employeeGroup", "Employee group"], ["emailAddress", "Email"],
  ["mobileNumber", "Mobile number"],
];

interface HrmsComparison {
  key: string;
  label: string;
  currentValue: string;
  proposedValue: string;
}

function hrmsRemarkProposals(hrms: HrmsEmployeeRecord) {
  return [
    { key: "remarks:department", label: "Remarks · Department", value: hrms.department ? "HRMS Department: " + hrms.department : "" },
    { key: "remarks:establishment", label: "Remarks · Establishment", value: hrms.establishment ? "HRMS Establishment: " + hrms.establishment : "" },
    { key: "remarks:father", label: "Remarks · Father’s name", value: hrms.fatherName ? "HRMS Father’s name: " + hrms.fatherName : "" },
    { key: "remarks:mother", label: "Remarks · Mother’s name", value: hrms.motherName ? "HRMS Mother’s name: " + hrms.motherName : "" },
  ].filter((proposal) => proposal.value);
}

function hrmsComparisons(result: HrmsLookupResult, currentValues: Record<string, string[]>, includeUsername: boolean): HrmsComparison[] {
  const proposals: Array<{ key: string; label: string; value: string }> = [
    ...(includeUsername ? [{ key: "username", label: "Username", value: result.draft.username }] : []),
    { key: "email", label: "Email", value: result.draft.email },
    { key: "firstName", label: "First name", value: result.draft.firstName },
    { key: "lastName", label: "Last name", value: result.draft.lastName },
    ...Object.entries(result.draft.attributes).map(([key, values]) => ({
      key,
      label: USER_PROFILE_FIELDS.find((field) => field.name === key)?.label ?? key,
      value: values.join(", "),
    })),
  ].filter((proposal) => proposal.value);
  const comparisons = proposals.map((proposal) => ({
    key: proposal.key,
    label: proposal.label,
    currentValue: currentValues[proposal.key]?.filter(Boolean).join(", ") || "Empty",
    proposedValue: proposal.value,
  }));
  const currentRemarks = currentValues.remarks?.filter(Boolean) ?? [];
  for (const proposal of hrmsRemarkProposals(result.hrms)) {
    comparisons.push({
      key: proposal.key,
      label: proposal.label,
      currentValue: currentRemarks.includes(proposal.value) ? proposal.value : "Not included in remarks",
      proposedValue: proposal.value,
    });
  }
  return comparisons;
}

function HrmsSourcePanel({ initialEmployeeId = "", currentValues, includeUsername = true, onApply }: {
  initialEmployeeId?: string;
  currentValues: Record<string, string[]>;
  includeUsername?: boolean;
  onApply: (result: HrmsLookupResult, selectedKeys: string[]) => void;
}) {
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [result, setResult] = useState<HrmsLookupResult | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => setEmployeeId(initialEmployeeId), [initialEmployeeId]);
  const comparisons = result ? hrmsComparisons(result, currentValues, includeUsername) : [];

  async function fetchEmployee() {
    if (!employeeId.trim()) return void toast.error("Enter an employee ID.");
    setLoading(true);
    try {
      const fetched = await api<HrmsLookupResult>("/api/hr/hrms/lookup", {
        method: "POST", body: JSON.stringify({ employeeId: employeeId.trim() }),
      });
      const proposed = hrmsComparisons(fetched, currentValues, includeUsername);
      setResult(fetched);
      setEmployeeId(fetched.hrms.employeeId);
      setSelectedKeys(proposed.filter((item) => item.proposedValue !== item.currentValue).map((item) => item.key));
      toast.success("HRMS details fetched. No form values were changed.");
    } catch (error) {
      setResult(null); setSelectedKeys([]); toast.error(errMsg(error));
    } finally { setLoading(false); }
  }

  function toggle(key: string, checked: boolean) {
    setSelectedKeys((current) => checked ? Array.from(new Set([...current, key])) : current.filter((item) => item !== key));
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div><h3 className="font-medium">HRMS source and proposed changes</h3>
        <p className="text-xs text-muted-foreground">Fetching is read-only. Review current and proposed values, then explicitly apply selected changes.</p></div>
      <div className="space-y-1.5"><Label htmlFor="hrms-employee-id">Employee ID</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="hrms-employee-id" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void fetchEmployee(); }} />
          <Button type="button" variant="outline" onClick={fetchEmployee} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />} Fetch employee details
          </Button>
        </div>
      </div>
      {result ? <>
        <div className="space-y-2">
          <div className="hidden grid-cols-[2rem_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
            <span /><span>Field</span><span>Current value</span><span>Proposed HRMS value</span>
          </div>
          {comparisons.map((item) => {
            const unchanged = item.currentValue === item.proposedValue;
            return <div key={item.key} className="grid gap-2 rounded-md border bg-background p-2 md:grid-cols-[2rem_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Checkbox aria-label={"Apply proposed " + item.label} checked={selectedKeys.includes(item.key)}
                disabled={unchanged} onCheckedChange={(checked) => toggle(item.key, checked === true)} />
              <p className="text-sm font-medium">{item.label}</p>
              <div><p className="text-xs text-muted-foreground md:hidden">Current</p><p className="break-words text-sm">{item.currentValue}</p></div>
              <div><p className="text-xs text-muted-foreground md:hidden">Proposed</p><p className="break-words text-sm">{item.proposedValue}</p></div>
            </div>;
          })}
        </div>
        <Button type="button" disabled={!selectedKeys.length} onClick={() => {
          onApply(result, selectedKeys);
          toast.success("Selected values applied to the form. Save the form to persist them.");
        }}>Apply selected values</Button>
        <details className="rounded-md border bg-background p-3">
          <summary className="cursor-pointer text-sm font-medium">View complete HRMS source record</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {HRMS_DISPLAY_FIELDS.map(([name, label]) => <div key={name} className="rounded-md border p-2">
              <p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-sm">{result.hrms[name] || "Not provided"}</p>
            </div>)}
          </div>
        </details>
      </> : <p className="text-sm text-muted-foreground">Fetch an employee record to compare it with the editable Keycloak form.</p>}
    </div>
  );
}

function CreateUserPanel({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    username: "",
    email: "",
    firstName: "",
    lastName: "",
    phoneNumber: "",
    employeeId: "",
    employmentType: "",
    designation: "",
    accountExpiryDate: "",
    remarks: [] as string[],
    hrmsEmployeeId: "",
    hrmsWarnings: [] as string[],
    sendOnboarding: true,
  });
  const [groupQuery, setGroupQuery] = useState("");
  const [groupResults, setGroupResults] = useState<KcGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<KcGroup[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function searchGroups(q: string) {
    setGroupQuery(q);
    if (!q.trim()) {
      setGroupResults([]);
      return;
    }
    try {
      const data = await api<{ groups: KcGroup[] }>(`/api/hr/groups?search=${encodeURIComponent(q)}`);
      setGroupResults(data.groups);
    } catch {
      setGroupResults([]);
    }
  }

  function addGroup(g: KcGroup) {
    if (!selectedGroups.find((s) => s.id === g.id)) {
      setSelectedGroups([...selectedGroups, g]);
    }
    setGroupQuery("");
    setGroupResults([]);
  }

  function applyHrmsDraft(result: HrmsLookupResult, selectedKeys: string[]) {
    const selected = new Set(selectedKeys);
    setForm((current) => {
      const next = { ...current };
      if (selected.has("username")) next.username = result.draft.username;
      if (selected.has("email")) next.email = result.draft.email;
      if (selected.has("firstName")) next.firstName = result.draft.firstName;
      if (selected.has("lastName")) next.lastName = result.draft.lastName;
      if (selected.has("phone_number")) next.phoneNumber = result.draft.attributes.phone_number?.[0] ?? "";
      if (selected.has("employee_id")) next.employeeId = result.draft.attributes.employee_id?.[0] ?? result.hrms.employeeId;
      if (selected.has("employment_type")) next.employmentType = result.draft.attributes.employment_type?.[0] ?? "";
      if (selected.has("designation")) next.designation = result.draft.attributes.designation?.[0] ?? "";
      if (selected.has("account_expiry_date")) next.accountExpiryDate = result.draft.attributes.account_expiry_date?.[0] ?? "";
      const remarks = [...current.remarks];
      for (const proposal of hrmsRemarkProposals(result.hrms)) {
        if (selected.has(proposal.key) && !remarks.includes(proposal.value)) remarks.push(proposal.value);
      }
      next.remarks = remarks;
      next.hrmsEmployeeId = result.hrms.employeeId;
      next.hrmsWarnings = result.draft.warnings;
      return next;
    });
  }

  async function submit() {
    if (!form.username.trim()) {
      toast.error("Username is required.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<{ id: string; onboardingSent: boolean; onboardingError?: string }>("/api/hr/users", {
        method: "POST",
        body: JSON.stringify({
          username: form.username.trim(),
          email: form.email || undefined,
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          phoneNumber: form.phoneNumber || undefined,
          attributes: {
            ...Object.fromEntries([
              ["employee_id", form.employeeId],
              ["employment_type", form.employmentType],
              ["designation", form.designation],
              ["account_expiry_date", form.accountExpiryDate],
            ].filter(([, value]) => Boolean(value)).map(([name, value]) => [name, [value]])),
            ...(form.remarks.filter(Boolean).length ? { remarks: form.remarks.filter(Boolean) } : {}),
          },
          hrmsEmployeeId: form.hrmsEmployeeId || undefined,
          groupPaths: selectedGroups.map((g) => g.path),
          sendOnboarding: form.sendOnboarding,
        }),
      });
      toast.success(
        `User ${form.username} created.` +
          (form.sendOnboarding
            ? result.onboardingSent
              ? " Onboarding email sent."
              : ` Onboarding email NOT sent (${result.onboardingError ?? "no email on file"}).`
            : ""),
      );
      onCreated(result.id);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
          <CardTitle>Create user</CardTitle>
          <CardDescription>Add a new SSO account and optionally assign existing groups.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">Username *</Label>
            <Input id="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              value={form.phoneNumber}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
            />
          </div>
          <div className="space-y-1.5"><Label htmlFor="employeeId">Employee ID</Label>
            <Input id="employeeId" value={form.employeeId}
              onChange={(event) => setForm({ ...form, employeeId: event.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="employmentType">Employment type</Label>
            <select id="employmentType" value={form.employmentType}
              onChange={(event) => setForm({ ...form, employmentType: event.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Select...</option>
              {USER_PROFILE_FIELDS.find((field) => field.name === "employment_type")?.options
                ?.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="designation">Designation</Label>
            <select id="designation" value={form.designation}
              onChange={(event) => setForm({ ...form, designation: event.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Select...</option>
              {USER_PROFILE_FIELDS.find((field) => field.name === "designation")?.options
                ?.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="accountExpiryDate">Account expiry date</Label>
            <Input id="accountExpiryDate" type="date" value={form.accountExpiryDate}
              onChange={(event) => setForm({ ...form, accountExpiryDate: event.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="remarks">Remarks</Label>
            <textarea id="remarks" rows={5} value={form.remarks.join("\n")}
              onChange={(event) => setForm({ ...form, remarks: event.target.value.split("\n") })}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <p className="text-xs text-muted-foreground">One remark per line.</p>
          </div>
          {form.hrmsWarnings.length > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Review unmapped HRMS values</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {form.hrmsWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>}
          <div className="space-y-1.5">
            <Label>Add to existing groups</Label>
            <Input placeholder="Search groups..." value={groupQuery} onChange={(e) => searchGroups(e.target.value)} />
            {groupResults.length > 0 && (
              <div className="rounded-md border p-2 text-sm">
                {groupResults.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => addGroup(g)}
                    className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
                  >
                    + {g.path}
                  </button>
                ))}
              </div>
            )}
            {selectedGroups.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {selectedGroups.map((g) => (
                  <Badge key={g.id} variant="secondary" className="gap-1">
                    {g.path}
                    <button
                      type="button"
                      className="ml-1 opacity-70 hover:opacity-100"
                      onClick={() => setSelectedGroups(selectedGroups.filter((s) => s.id !== g.id))}
                    >
                      x
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="sendOnboarding"
              checked={form.sendOnboarding}
              onCheckedChange={(checked) => setForm({ ...form, sendOnboarding: checked === true })}
            />
            <Label htmlFor="sendOnboarding" className="font-normal">
              Send onboarding email (verify email, set password, TOTP, recovery codes)
            </Label>
          </div>
          </div>
          <HrmsSourcePanel
            currentValues={{
              username: [form.username], email: [form.email],
              firstName: [form.firstName], lastName: [form.lastName],
              phone_number: [form.phoneNumber], employee_id: [form.employeeId],
              employment_type: [form.employmentType], designation: [form.designation],
              account_expiry_date: [form.accountExpiryDate], remarks: form.remarks,
            }}
            onApply={applyHrmsDraft}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </CardContent>
    </Card>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: KcUser | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [temporary, setTemporary] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setPassword("");
      setTemporary(true);
      setGeneratedPassword(null);
    }
  }, [user]);

  async function submit() {
    if (!user) return;
    setSubmitting(true);
    try {
      const result = await api<{ generatedPassword?: string }>(`/api/hr/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: password || undefined, temporary, generate: !password }),
      });
      if (result.generatedPassword) {
        setGeneratedPassword(result.generatedPassword);
      } else {
        toast.success(`Password set for ${user.username}.`);
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password: {user?.username}</DialogTitle>
        </DialogHeader>
        {generatedPassword ? (
          <>
            <p className="text-sm">Share this password with the user now - it will not be shown again:</p>
            <div className="rounded-md border bg-muted p-3 font-mono text-base">{generatedPassword}</div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password (leave blank to auto-generate)</Label>
                <Input id="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="temporary" checked={temporary} onCheckedChange={(c) => setTemporary(c === true)} />
                <Label htmlFor="temporary" className="font-normal">
                  Require change at next login (temporary)
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                Set password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManageGroupsDialog({
  user,
  onOpenChange,
}: {
  user: KcUser | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [memberGroups, setMemberGroups] = useState<KcGroup[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KcGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await api<{ groups: KcGroup[] }>(`/api/hr/users/${user.id}`);
      setMemberGroups(data.groups);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setQuery("");
      setResults([]);
      load();
    }
  }, [user, load]);

  async function search(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const data = await api<{ groups: KcGroup[] }>(`/api/hr/groups?search=${encodeURIComponent(q)}`);
    setResults(data.groups.filter((g) => !memberGroups.find((m) => m.id === g.id)));
  }

  async function add(g: KcGroup) {
    if (!user) return;
    try {
      await api(`/api/hr/users/${user.id}/groups/${g.id}`, { method: "PUT" });
      setQuery("");
      setResults([]);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function remove(g: KcGroup) {
    if (!user) return;
    try {
      await api(`/api/hr/users/${user.id}/groups/${g.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Groups: {user?.username}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Current groups</Label>
              {memberGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">Not a member of any group.</p>
              )}
              {memberGroups.map((g) => (
                <div key={g.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                  <span>{g.path}</span>
                  <Button size="sm" variant="ghost" onClick={() => remove(g)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Add to a group</Label>
              <Input placeholder="Search groups..." value={query} onChange={(e) => search(e.target.value)} />
              {results.length > 0 && (
                <div className="rounded-md border p-2 text-sm">
                  {results.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => add(g)}
                      className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
                    >
                      + {g.path}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
