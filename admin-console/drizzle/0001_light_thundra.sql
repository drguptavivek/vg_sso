CREATE TYPE "public"."self_registration_status" AS ENUM('pending', 'processing', 'completed', 'blocked', 'failed');--> statement-breakpoint
CREATE TABLE "self_registration_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar(64) NOT NULL,
	"employee_id_hash" varchar(64) NOT NULL,
	"request_ip_hash" varchar(64) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"hrms_fingerprint" varchar(64) NOT NULL,
	"status" "self_registration_status" DEFAULT 'pending' NOT NULL,
	"result_code" varchar(64),
	"keycloak_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "self_registration_attempts_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "self_registration_attempts_employee_idx" ON "self_registration_attempts" USING btree ("employee_id_hash","created_at");--> statement-breakpoint
CREATE INDEX "self_registration_attempts_ip_idx" ON "self_registration_attempts" USING btree ("request_ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "self_registration_attempts_status_expiry_idx" ON "self_registration_attempts" USING btree ("status","expires_at");