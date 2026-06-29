-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "maxUses" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_redemptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "orderId" TEXT,
    "customerId" TEXT,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_tenantId_code_key" ON "vouchers"("tenantId", "code");

-- CreateIndex
CREATE INDEX "voucher_redemptions_tenantId_voucherId_idx" ON "voucher_redemptions"("tenantId", "voucherId");

-- AddForeignKey
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Vouchers: master mutável; redemptions append-only =====
GRANT SELECT, INSERT, UPDATE, DELETE ON vouchers TO gelato_app;
GRANT SELECT, INSERT ON voucher_redemptions TO gelato_app;
DROP TRIGGER IF EXISTS voucher_redemptions_append_only ON voucher_redemptions;
CREATE TRIGGER voucher_redemptions_append_only BEFORE UPDATE OR DELETE ON voucher_redemptions
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
