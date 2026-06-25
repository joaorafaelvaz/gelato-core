-- AlterTable
ALTER TABLE "tse_transactions" ADD COLUMN     "isAusfall" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "txNumber" DROP NOT NULL,
ALTER COLUMN "signatureCounter" DROP NOT NULL,
ALTER COLUMN "signatureValue" DROP NOT NULL,
ALTER COLUMN "logTime" DROP NOT NULL;

-- CreateTable
CREATE TABLE "tse_ausfall_log" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "kasseId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "clientEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tse_ausfall_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tse_ausfall_log_clientEventId_key" ON "tse_ausfall_log"("clientEventId");

-- ===== Imutabilidade fiscal: tse_ausfall_log (append-only) =====
GRANT SELECT, INSERT ON tse_ausfall_log TO gelato_app;
DROP TRIGGER IF EXISTS tse_ausfall_log_append_only ON tse_ausfall_log;
CREATE TRIGGER tse_ausfall_log_append_only
  BEFORE UPDATE OR DELETE ON tse_ausfall_log
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
