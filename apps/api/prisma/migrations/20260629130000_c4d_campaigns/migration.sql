-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "recipientCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_dispatches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_dispatches_tenantId_campaignId_idx" ON "campaign_dispatches"("tenantId", "campaignId");

-- AddForeignKey
ALTER TABLE "campaign_dispatches" ADD CONSTRAINT "campaign_dispatches_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Campanhas: master mutável; dispatches append-only =====
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO gelato_app;
GRANT SELECT, INSERT ON campaign_dispatches TO gelato_app;
DROP TRIGGER IF EXISTS campaign_dispatches_append_only ON campaign_dispatches;
CREATE TRIGGER campaign_dispatches_append_only BEFORE UPDATE OR DELETE ON campaign_dispatches
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
