-- CreateEnum
CREATE TYPE "PurchaseRecommendationStatus" AS ENUM ('PENDING', 'ORDERED', 'DISMISSED');

-- CreateTable
CREATE TABLE "purchase_recommendations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "recommended_quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PurchaseRecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "agent_metadata" JSONB,
    "resolved_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_recommendations_organization_id_status_idx" ON "purchase_recommendations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "purchase_recommendations_product_id_status_idx" ON "purchase_recommendations"("product_id", "status");

-- AddForeignKey
ALTER TABLE "purchase_recommendations" ADD CONSTRAINT "purchase_recommendations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_recommendations" ADD CONSTRAINT "purchase_recommendations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
