-- CreateEnum
CREATE TYPE "RecurrenceCadence" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "recurring_invoice_id" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "issued_at" TIMESTAMP(3),
ADD COLUMN     "paid_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "cadence" "RecurrenceCadence" NOT NULL DEFAULT 'MONTHLY',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "net_terms_days" INTEGER NOT NULL DEFAULT 30,
    "issue_on_create" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "line_items" JSONB NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "generated_count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_invoices_organization_id_active_idx" ON "recurring_invoices"("organization_id", "active");

-- CreateIndex
CREATE INDEX "recurring_invoices_active_next_run_at_idx" ON "recurring_invoices"("active", "next_run_at");

-- CreateIndex
CREATE INDEX "invoices_status_due_date_idx" ON "invoices"("status", "due_date");

-- CreateIndex
CREATE INDEX "invoices_recurring_invoice_id_idx" ON "invoices"("recurring_invoice_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_invoice_id_fkey" FOREIGN KEY ("recurring_invoice_id") REFERENCES "recurring_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
