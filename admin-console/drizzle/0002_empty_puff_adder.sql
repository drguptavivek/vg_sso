ALTER TABLE "self_registration_attempts" ALTER COLUMN "employee_id" DROP NOT NULL;
UPDATE "self_registration_attempts"
SET "employee_id" = NULL
WHERE "status" IN ('completed', 'blocked', 'failed');
