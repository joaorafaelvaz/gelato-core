-- DropForeignKey
ALTER TABLE "tse_transactions" DROP CONSTRAINT "tse_transactions_orderId_fkey";

-- AlterTable
ALTER TABLE "tse_transactions" ADD COLUMN     "bestellungId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "tische" (
    "id" TEXT NOT NULL,
    "betriebsstaetteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER,
    "posX" INTEGER,
    "posY" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tische_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tischsessions" (
    "id" TEXT NOT NULL,
    "tischId" TEXT NOT NULL,
    "kasseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedBy" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "orderId" TEXT,

    CONSTRAINT "tischsessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bestellungen" (
    "id" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kasseId" TEXT NOT NULL,
    "seqNr" INTEGER NOT NULL,
    "createdBy" TEXT,
    "totalNet" INTEGER NOT NULL,
    "totalMwst" INTEGER NOT NULL,
    "totalGross" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bestellungen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bestellung_items" (
    "id" TEXT NOT NULL,
    "bestellungId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitNet" INTEGER NOT NULL,
    "mwstRate" DECIMAL(5,4) NOT NULL,
    "mwstCode" TEXT NOT NULL,
    "stornoOf" TEXT,

    CONSTRAINT "bestellung_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tischsessions_orderId_key" ON "tischsessions"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "bestellungen_clientEventId_key" ON "bestellungen"("clientEventId");

-- CreateIndex
CREATE UNIQUE INDEX "tse_transactions_bestellungId_key" ON "tse_transactions"("bestellungId");

-- AddForeignKey
ALTER TABLE "tse_transactions" ADD CONSTRAINT "tse_transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tse_transactions" ADD CONSTRAINT "tse_transactions_bestellungId_fkey" FOREIGN KEY ("bestellungId") REFERENCES "bestellungen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tische" ADD CONSTRAINT "tische_betriebsstaetteId_fkey" FOREIGN KEY ("betriebsstaetteId") REFERENCES "betriebsstaetten"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tischsessions" ADD CONSTRAINT "tischsessions_tischId_fkey" FOREIGN KEY ("tischId") REFERENCES "tische"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bestellungen" ADD CONSTRAINT "bestellungen_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "tischsessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bestellung_items" ADD CONSTRAINT "bestellung_items_bestellungId_fkey" FOREIGN KEY ("bestellungId") REFERENCES "bestellungen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Imutabilidade fiscal: bestellungen + bestellung_items (append-only) =====
GRANT SELECT, INSERT ON bestellungen, bestellung_items TO gelato_app;
DROP TRIGGER IF EXISTS bestellungen_append_only ON bestellungen;
CREATE TRIGGER bestellungen_append_only BEFORE UPDATE OR DELETE ON bestellungen
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
DROP TRIGGER IF EXISTS bestellung_items_append_only ON bestellung_items;
CREATE TRIGGER bestellung_items_append_only BEFORE UPDATE OR DELETE ON bestellung_items
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();

-- ===== Operacionais (mutáveis): DML p/ gelato_app =====
GRANT SELECT, INSERT, UPDATE, DELETE ON tische, tischsessions TO gelato_app;

-- ===== 1 sessão aberta por mesa =====
CREATE UNIQUE INDEX one_open_session_per_tisch ON tischsessions ("tischId") WHERE status = 'open';
