-- CreateTable
CREATE TABLE "integration_events" (
    "seq" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kasseId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "integration_events_tenantId_seq_idx" ON "integration_events"("tenantId", "seq");

-- Runtime (gelato_app): escreve a outbox na mesma transação da venda e lê para o feed.
GRANT SELECT, INSERT ON integration_events TO gelato_app;
GRANT USAGE, SELECT ON SEQUENCE integration_events_seq_seq TO gelato_app;
