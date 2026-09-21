export interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string[]>;
  createdTimestamp?: number;
  adminAccess?: string[];
  mfaConfigured?: boolean;
  mfaCredentialTypes?: string[];
  requiredActions?: string[];
}

export interface KcUserSession {
  id: string;
  username?: string;
  userId?: string;
  ipAddress?: string;
  start?: number;
  lastAccess?: number;
  rememberMe?: boolean;
  clients?: Record<string, string>;
}

export interface KcGroup {
  id: string;
  name: string;
  path: string;
  parentId?: string;
  attributes?: Record<string, string[]>;
  subGroupCount?: number;
  subGroups?: KcGroup[];
}

export interface KcClient {
  id: string;
  clientId: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  protocol?: string;
  publicClient?: boolean;
  clientAuthenticatorType?: string;
  standardFlowEnabled?: boolean;
  implicitFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean;
  authorizationServicesEnabled?: boolean;
  redirectUris?: string[];
  webOrigins?: string[];
  postLogoutRedirectUris?: string[];
  bearerOnly?: boolean;
  frontchannelLogout?: boolean;
  attributes?: Record<string, string>;
  defaultClientScopes?: string[];
  optionalClientScopes?: string[];
}

export interface KcRole {
  id: string;
  name: string;
  description?: string;
}

export interface CreateUserRequest {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  attributes?: Record<string, string[]>;
  hrmsEmployeeId?: string;
  groupPaths?: string[];
  sendOnboarding?: boolean;
}

export interface GroupTreeNode extends KcGroup {
  children: GroupTreeNode[];
  memberCount?: number;
}
