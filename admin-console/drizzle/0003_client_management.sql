CREATE TYPE "public"."client_application_type" AS ENUM('spa', 'server-web', 'native', 'm2m');--> statement-breakpoint
CREATE TYPE "public"."client_environment" AS ENUM('development', 'staging', 'production');--> statement-breakpoint
CREATE TYPE "public"."client_management_status" AS ENUM('provisioning', 'active', 'provisioning_failed', 'suspended');--> statement-breakpoint
CREATE TABLE "client_metadata" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "keycloak_client_uuid" varchar(128) NOT NULL,
  "client_id" varchar(128) NOT NULL,
  "display_name" varchar(255),
  "description" varchar(2000),
  "environment" "client_environment" NOT NULL,
  "application_type" "client_application_type" NOT NULL,
  "business_owner" varchar(255),
  "technical_owner" varchar(255),
  "primary_contact_email" varchar(320),
  "secondary_contact_email" varchar(320),
  "support_contact" varchar(320),
  "justification" varchar(2000),
  "status" "client_management_status" DEFAULT 'provisioning' NOT NULL,
  "created_by" uuid NOT NULL,
  "approved_by" uuid,
  "onboarding_pack_version" varchar(64),
  "role_api_status" varchar(32) DEFAULT 'not_available' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_metadata_keycloak_client_uuid_unique" UNIQUE("keycloak_client_uuid"),
  CONSTRAINT "client_metadata_client_id_unique" UNIQUE("client_id")
);--> statement-breakpoint
CREATE INDEX "client_metadata_environment_idx" ON "client_metadata" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "client_metadata_status_idx" ON "client_metadata" USING btree ("status");
