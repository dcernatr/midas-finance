CREATE SCHEMA "midas_private";
--> statement-breakpoint
CREATE TABLE "midas_private"."records" (
	"table_id" text NOT NULL,
	"id" text NOT NULL,
	"owner_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "records_table_id_id_pk" PRIMARY KEY("table_id","id")
);
--> statement-breakpoint
ALTER TABLE "midas_private"."records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "records_owner" ON "midas_private"."records" USING btree ("table_id","owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_month_per_user" ON "midas_private"."records" USING btree ("owner_id",("data"->>'month_key')) WHERE "midas_private"."records"."table_id" = 'midas_financial_months';--> statement-breakpoint
CREATE UNIQUE INDEX "one_source_per_user" ON "midas_private"."records" USING btree ("owner_id") WHERE "midas_private"."records"."table_id" = 'midas_spreadsheet_sources';--> statement-breakpoint
CREATE UNIQUE INDEX "one_profile_per_user" ON "midas_private"."records" USING btree ("owner_id") WHERE "midas_private"."records"."table_id" = 'midas_budget_profiles';--> statement-breakpoint
CREATE UNIQUE INDEX "unique_movement_code" ON "midas_private"."records" USING btree ("owner_id",("data"->>'midas_code')) WHERE "midas_private"."records"."table_id" = 'midas_transactions';