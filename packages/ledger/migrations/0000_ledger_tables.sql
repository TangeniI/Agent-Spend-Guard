CREATE TYPE "public"."payment_kind" AS ENUM('payment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('executed', 'rejected', 'held', 'released');--> statement-breakpoint
CREATE TABLE "balances" (
	"mandate_id" uuid PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"budget_minor" bigint NOT NULL,
	"spent_minor" bigint DEFAULT 0 NOT NULL,
	"held_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balances_non_negative" CHECK ("balances"."spent_minor" >= 0 AND "balances"."held_minor" >= 0),
	CONSTRAINT "balances_within_budget" CHECK ("balances"."spent_minor" + "balances"."held_minor" <= "balances"."budget_minor")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"account" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_non_zero" CHECK ("ledger_entries"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" "payment_kind" DEFAULT 'payment' NOT NULL,
	"reverses_payment_id" uuid,
	"merchant" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "payment_status" NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_mandate_id_balances_mandate_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."balances"("mandate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_payment_idx" ON "ledger_entries" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_mandate_key_unique" ON "payments" USING btree ("mandate_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reverses_unique" ON "payments" USING btree ("reverses_payment_id");