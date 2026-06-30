-- CreateTable
CREATE TABLE "production_recipes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outputStockItemId" TEXT NOT NULL,
    "yieldQty" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_recipe_ingredients" (
    "id" TEXT NOT NULL,
    "productionRecipeId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "production_recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_recipes_tenantId_outputStockItemId_key" ON "production_recipes"("tenantId", "outputStockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "production_recipe_ingredients_productionRecipeId_stockItemI_key" ON "production_recipe_ingredients"("productionRecipeId", "stockItemId");

-- AddForeignKey
ALTER TABLE "production_recipes" ADD CONSTRAINT "production_recipes_outputStockItemId_fkey" FOREIGN KEY ("outputStockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_recipe_ingredients" ADD CONSTRAINT "production_recipe_ingredients_productionRecipeId_fkey" FOREIGN KEY ("productionRecipeId") REFERENCES "production_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_recipe_ingredients" ADD CONSTRAINT "production_recipe_ingredients_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Produção: master data (mutável) — DML p/ gelato_app =====
GRANT SELECT, INSERT, UPDATE, DELETE ON production_recipes, production_recipe_ingredients TO gelato_app;
