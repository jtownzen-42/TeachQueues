ALTER TABLE "products" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sample_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brand_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "products_user_sample_key_uq" ON "products" USING btree ("user_id","sample_key");