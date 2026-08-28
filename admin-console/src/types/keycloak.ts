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
}

export interface KcGroup {
  id: string;
  name: string;
  path: string;
  parentId?: string;
  subGroupCount?: number;
  subGroups?: KcGroup[];
}

export interface CreateUserRequest {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  groupPaths?: string[];
  sendOnboarding?: boolean;
}

export interface GroupTreeNode extends KcGroup {
  children: GroupTreeNode[];
  memberCount?: number;
}
