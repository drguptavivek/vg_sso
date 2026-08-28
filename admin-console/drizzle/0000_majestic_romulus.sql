CREATE TYPE "public"."admin_action_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."contact_kind" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."contact_purpose" AS ENUM('alternate', 'official', 'emergency', 'other');--> statement-breakpoint
CREATE TABLE "admin_action_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_username" varchar(255),
	"target_user_id" uuid,
	"action" varchar(128) NOT NULL,
	"outcome" "admin_action_outcome" NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_additional_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keycloak_user_id" uuid NOT NULL,
	"kind" "contact_kind" NOT NULL,
	"purpose" "contact_purpose" DEFAULT 'alternate' NOT NULL,
	"value" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_extensions" (
	"keycloak_user_id" uuid PRIMARY KEY NOT NULL,
	"hrms_employee_id" varchar(64),
	"date_of_birth" date,
	"father_name" varchar(255),
	"mother_name" varchar(255),
	"pan_last5" varchar(5),
	"eoffice_id" varchar(128),
	"edu_email" varchar(320),
	"ehospital_id" varchar(128),
	"content_provider_email" varchar(320),
	"roll_number" varchar(128),
	"company_name" varchar(255),
	"request_eoffice_receipt_number" varchar(128),
	"request_eoffice_receipt_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_extensions_hrms_employee_id_unique" UNIQUE("hrms_employee_id")
);
--> statement-breakpoint
ALTER TABLE "user_additional_contacts" ADD CONSTRAINT "user_additional_contacts_keycloak_user_id_user_extensions_keycloak_user_id_fk" FOREIGN KEY ("keycloak_user_id") REFERENCES "public"."user_extensions"("keycloak_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_action_logs_occurred_idx" ON "admin_action_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "admin_action_logs_actor_idx" ON "admin_action_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "admin_action_logs_target_idx" ON "admin_action_logs" USING btree ("target_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_additional_contacts_user_kind_value_uidx" ON "user_additional_contacts" USING btree ("keycloak_user_id","kind","value");--> statement-breakpoint
CREATE INDEX "user_additional_contacts_user_idx" ON "user_additional_contacts" USING btree ("keycloak_user_id");--> statement-breakpoint
CREATE INDEX "user_extensions_hrms_employee_idx" ON "user_extensions" USING btree ("hrms_employee_id");