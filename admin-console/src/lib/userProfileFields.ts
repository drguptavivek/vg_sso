export type UserProfileControl = "text" | "email" | "select" | "textarea" | "date" | "timezone";

export interface UserProfileField {
  name: string;
  label: string;
  source: "core" | "attribute";
  control: UserProfileControl;
  multivalued?: boolean;
  editable?: boolean;
  required?: boolean;
  options?: readonly string[];
  maxLength?: number;
  pattern?: string;
  helpText?: string;
  placeholder?: string;
}

const DESIGNATIONS = [
  "Director", "Dean", "Medical Superintendent", "Professor", "Additional Professor",
  "Associate Professor", "Assistant Professor", "Senior Resident", "Junior Resident",
  "Chief Medical Officer", "Medical Officer", "Consultant", "Specialist", "Registrar",
  "Demonstrator", "Tutor", "Scientist I", "Scientist II", "Scientist III", "Scientist IV",
  "Scientist V", "Lab Technician", "Senior Lab Technician", "Junior Lab Technician",
  "Research Associate", "Research Fellow", "Project Scientist", "Project Assistant",
  "Project Technician", "Data Manager", "Biostatistician", "Epidemiologist",
  "Clinical Psychologist", "Physiotherapist", "Occupational Therapist", "Speech Therapist",
  "Dietician", "Pharmacist", "Senior Pharmacist", "Store Officer", "Administrative Officer",
  "Section Officer", "Accounts Officer", "Finance Officer", "HR Officer", "IT Officer",
  "System Analyst", "Network Engineer", "Security Officer", "Public Relations Officer",
  "Legal Officer", "Warden", "Matron", "Nursing Superintendent",
  "Deputy Nursing Superintendent", "Assistant Nursing Superintendent", "Staff Nurse", "ANM",
  "Driver", "Attendant", "Housekeeping Supervisor",
] as const;

export const USER_PROFILE_FIELDS: readonly UserProfileField[] = [
  { name: "username", label: "Username", source: "core", control: "text", required: true, maxLength: 255 },
  { name: "email", label: "Email", source: "core", control: "email", required: true, maxLength: 255 },
  { name: "firstName", label: "First name", source: "core", control: "text", required: true, maxLength: 255 },
  { name: "lastName", label: "Last name", source: "core", control: "text", required: true, maxLength: 255 },
  {
    name: "phone_number",
    label: "Phone number",
    source: "attribute",
    control: "text",
    maxLength: 20,
    pattern: "^\\+?[0-9]{10,15}$",
    placeholder: "+919876543210",
  },
  {
    name: "phone_verified",
    label: "Phone verified",
    source: "attribute",
    control: "select",
    options: ["true", "false"],
    editable: false,
    helpText: "View only. A user becomes verified only after completing OTP validation.",
  },
  {
    name: "employment_type",
    label: "Employment type",
    source: "attribute",
    control: "select",
    options: ["Permanent", "Contract", "Research", "Student", "Deputed", "Outsourced"],
  },
  { name: "employee_id", label: "Employee ID", source: "attribute", control: "text", maxLength: 32 },
  {
    name: "posts",
    label: "Posts",
    source: "attribute",
    control: "text",
    multivalued: true,
    maxLength: 50,
    helpText: "Add each post as a separate value.",
  },
  {
    name: "designation",
    label: "Designation",
    source: "attribute",
    control: "select",
    options: DESIGNATIONS,
  },
  {
    name: "remarks",
    label: "Remarks",
    source: "attribute",
    control: "textarea",
    multivalued: true,
    maxLength: 1000,
    helpText: "Add each remark as a separate value.",
  },
  {
    name: "account_expiry_date",
    label: "Account expiry date",
    source: "attribute",
    control: "date",
    pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    helpText: "Expiry date in the user’s local timezone.",
  },
  {
    name: "account_expiry_timezone",
    label: "Account expiry timezone",
    source: "attribute",
    control: "timezone",
    placeholder: "Asia/Kolkata",
    helpText: "Use an IANA timezone.",
  },
] as const;

export const USER_PROFILE_CORE_FIELDS = new Set(
  USER_PROFILE_FIELDS.filter((field) => field.source === "core").map((field) => field.name),
);

export const USER_PROFILE_ATTRIBUTE_FIELDS = new Set(
  USER_PROFILE_FIELDS
    .filter((field) => field.source === "attribute" && field.editable !== false)
    .map((field) => field.name),
);

export function supportedTimezones(current?: string): string[] {
  const values = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return Array.from(new Set(["Asia/Kolkata", ...(current ? [current] : []), ...values])).sort();
}
