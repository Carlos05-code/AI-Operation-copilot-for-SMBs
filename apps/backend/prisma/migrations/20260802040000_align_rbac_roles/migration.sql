-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER');
ALTER TABLE "public"."members" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "members" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "members" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
COMMIT;

-- AlterTable
ALTER TABLE "members" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
