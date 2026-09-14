-- CreateTable
CREATE TABLE "executive_briefings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "highlights" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "focus_areas" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executive_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "executive_briefings_organization_id_createdAt_idx" ON "executive_briefings"("organization_id", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "executive_briefings" ADD CONSTRAINT "executive_briefings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
