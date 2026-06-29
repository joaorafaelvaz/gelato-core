-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pointsPerEuro" INTEGER NOT NULL DEFAULT 0,
    "stampsPerItem" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "stamps" INTEGER NOT NULL DEFAULT 0,
    "refType" TEXT,
    "refId" TEXT,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_tenantId_key" ON "loyalty_programs"("tenantId");

-- CreateIndex
CREATE INDEX "loyalty_entries_tenantId_customerId_idx" ON "loyalty_entries"("tenantId", "customerId");

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Loyalty: programa mutável; entries append-only =====
GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty_programs TO gelato_app;
GRANT SELECT, INSERT ON loyalty_entries TO gelato_app;
DROP TRIGGER IF EXISTS loyalty_entries_append_only ON loyalty_entries;
CREATE TRIGGER loyalty_entries_append_only BEFORE UPDATE OR DELETE ON loyalty_entries
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
