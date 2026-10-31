ALTER TABLE "users" ADD COLUMN "token_scope" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "channels_cache" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "channels_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;