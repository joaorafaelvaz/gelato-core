-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "tischSessionId" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tischSessionId_fkey" FOREIGN KEY ("tischSessionId") REFERENCES "tischsessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

