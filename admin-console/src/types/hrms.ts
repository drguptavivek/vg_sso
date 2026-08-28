export interface HrmsEmployeeRecord {
  employeeId: string;
  name: string;
  fatherName: string | null;
  motherName: string | null;
  panLast5: string | null;
  dateOfBirth: string | null;
  dateOfJoining: string | null;
  retirementDate: string | null;
  department: string | null;
  designation: string | null;
  emailAddress: string | null;
  employeeGroup: string | null;
  establishment: string | null;
  jobCategory: string | null;
  mobileNumber: string | null;
}

export interface KeycloakProfileDraft {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  attributes: Record<string, string[]>;
  warnings: string[];
}

export interface HrmsLookupResult {
  hrms: HrmsEmployeeRecord;
  draft: KeycloakProfileDraft;
}
