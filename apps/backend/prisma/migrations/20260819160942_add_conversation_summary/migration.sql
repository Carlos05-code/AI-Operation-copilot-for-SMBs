-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summary_generated_at" TIMESTAMP(3);
