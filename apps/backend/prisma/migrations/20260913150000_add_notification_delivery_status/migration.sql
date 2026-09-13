-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "delivery_status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "delivery_error" TEXT;

-- CreateIndex
CREATE INDEX "notifications_delivery_status_createdAt_idx" ON "notifications"("delivery_status", "createdAt");
