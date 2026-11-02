ALTER TABLE "campaigns" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "key_message" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "campaigns_user_id_idx" ON "campaigns" USING btree ("user_id");