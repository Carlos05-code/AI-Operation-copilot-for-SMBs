-- CreateTable
CREATE TABLE "invoice_number_counters" (
    "organization_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_number_counters_pkey" PRIMARY KEY ("organization_id","year")
);

-- AddForeignKey
ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
