ALTER TABLE "api_key" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clerk_identity" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "api_key" CASCADE;--> statement-breakpoint
DROP TABLE "clerk_identity" CASCADE;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "merchbase_user_id" SET NOT NULL;