ALTER TABLE "change_orders" ADD COLUMN "recurring_contract_id" integer;--> statement-breakpoint
ALTER TABLE "change_orders" ADD COLUMN "new_monthly_amount" numeric;--> statement-breakpoint
ALTER TABLE "change_orders" ALTER COLUMN "work_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_recurring_contract_id_recurring_contracts_id_fkey" FOREIGN KEY ("recurring_contract_id") REFERENCES "recurring_contracts"("id");