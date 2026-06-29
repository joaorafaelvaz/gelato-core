-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "textSnapshot" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consent_versions_tenantId_purpose_version_key" ON "consent_versions"("tenantId", "purpose", "version");

-- CreateIndex
CREATE INDEX "consent_records_tenantId_customerId_idx" ON "consent_records"("tenantId", "customerId");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== CRM: master data mutável (customers, consent_versions) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON customers, consent_versions TO gelato_app;

-- ===== Consentimento: trilha append-only (DSGVO, reusa fiscal_append_only) =====
GRANT SELECT, INSERT ON consent_records TO gelato_app;
DROP TRIGGER IF EXISTS consent_records_append_only ON consent_records;
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
