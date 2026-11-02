CREATE TABLE "buffer_rate_limits" (
	"window_seconds" integer PRIMARY KEY NOT NULL,
	"quota" integer,
	"remaining" integer,
	"reset_at" timestamp with time zone,
	"busy_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buffer_posts" ADD COLUMN "buffer_status" text;--> statement-breakpoint
ALTER TABLE "buffer_posts" ADD COLUMN "buffer_error" text;--> statement-breakpoint
ALTER TABLE "buffer_posts" ADD COLUMN "buffer_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buffer_posts" ADD COLUMN "buffer_missing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "posts_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "posts_read_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "results_campaign_day_uq" ON "results" USING btree ("campaign_id","day");