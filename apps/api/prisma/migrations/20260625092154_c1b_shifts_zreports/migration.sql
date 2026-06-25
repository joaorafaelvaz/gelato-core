/*
  Warnings:

  - Added the required column `coveredFrom` to the `z_reports` table without a default value. This is not possible if the table is not empty.
  - Added the required column `coveredTo` to the `z_reports` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "differenz" INTEGER,
ADD COLUMN     "expectedCash" INTEGER,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'open';

-- AlterTable
ALTER TABLE "z_reports" ADD COLUMN     "coveredFrom" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "coveredTo" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "userId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Imutabilidade fiscal: cash_movements (append-only) =====
GRANT SELECT, INSERT ON cash_movements TO gelato_app;
DROP TRIGGER IF EXISTS cash_movements_append_only ON cash_movements;
CREATE TRIGGER cash_movements_append_only
  BEFORE UPDATE OR DELETE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
