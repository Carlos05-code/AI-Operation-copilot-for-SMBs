-- AlterTable
ALTER TABLE "products" ADD COLUMN     "below_reorder_point" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "products_active_reorder_point_idx" ON "products"("active", "reorder_point");
