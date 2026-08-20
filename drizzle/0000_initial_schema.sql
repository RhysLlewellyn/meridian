CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"during" "tstzrange" GENERATED ALWAYS AS (tstzrange("starts_at", "ends_at", '[)')) STORED,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practitioner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"bio" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practitioner_service" (
	"practitioner_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"duration_minutes_override" integer,
	"price_pence_override" integer,
	CONSTRAINT "practitioner_service_practitioner_id_service_id_pk" PRIMARY KEY("practitioner_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"default_duration_minutes" integer NOT NULL,
	"price_pence" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"during" "tstzrange" GENERATED ALWAYS AS (tstzrange("starts_at", "ends_at", '[)')) STORED
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_service" ADD CONSTRAINT "practitioner_service_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_service" ADD CONSTRAINT "practitioner_service_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_booking_idx" ON "audit_log" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reference_key" ON "booking" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "booking_practitioner_starts_idx" ON "booking" USING btree ("practitioner_id","starts_at");--> statement-breakpoint
CREATE INDEX "booking_client_idx" ON "booking" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_email_idx" ON "client" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "practitioner_slug_key" ON "practitioner" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "practitioner_service_service_idx" ON "practitioner_service" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_slug_key" ON "service" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "time_off_practitioner_starts_idx" ON "time_off" USING btree ("practitioner_id","starts_at");--> statement-breakpoint
CREATE INDEX "working_hours_practitioner_weekday_idx" ON "working_hours" USING btree ("practitioner_id","weekday");