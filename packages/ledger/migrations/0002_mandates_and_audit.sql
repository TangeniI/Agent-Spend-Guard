CREATE TYPE "public"."audit_actor" AS ENUM('agent', 'policy', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."decision_outcome" AS ENUM('APPROVE', 'REJECT', 'NEEDS_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."mandate_status" AS ENUM('active', 'paused', 'revoked');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"actor" "audit_actor" NOT NULL,
	"mandate_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"outcome" "decision_outcome" NOT NULL,
	"reasons" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"per_item_limit_minor" bigint NOT NULL,
	"allowed_merchant_categories" text[] NOT NULL,
	"blocked_merchants" text[] DEFAULT '{}'::text[] NOT NULL,
	"max_quantity_per_item" integer NOT NULL,
	"approval_threshold_minor" bigint NOT NULL,
	"split_window_minutes" integer DEFAULT 10 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "mandate_status" DEFAULT 'active' NOT NULL,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandates_limits_positive" CHECK ("mandates"."per_item_limit_minor" > 0 AND "mandates"."approval_threshold_minor" > 0),
	CONSTRAINT "mandates_quantity_positive" CHECK ("mandates"."max_quantity_per_item" > 0),
	CONSTRAINT "mandates_window_non_negative" CHECK ("mandates"."split_window_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"name" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_id_balances_mandate_id_fk" FOREIGN KEY ("id") REFERENCES "public"."balances"("mandate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_mandate_created_idx" ON "audit_events" USING btree ("mandate_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_proposal_idx" ON "decisions" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposals_mandate_key_idx" ON "proposals" USING btree ("mandate_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_recent_idx" ON "payments" USING btree ("mandate_id","merchant","created_at");