-- CreateTable
CREATE TABLE "checklist_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kasseId" TEXT NOT NULL,
    "executedBy" TEXT,
    "clientEventId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_task_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "validMin" INTEGER,
    "validMax" INTEGER,
    "valueBool" BOOLEAN,
    "valueNum" INTEGER,
    "valueText" TEXT,
    "ok" BOOLEAN NOT NULL,
    "reading" TEXT,
    "correctiveAction" TEXT,

    CONSTRAINT "checklist_task_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checklist_runs_clientEventId_key" ON "checklist_runs"("clientEventId");

-- AddForeignKey
ALTER TABLE "checklist_task_results" ADD CONSTRAINT "checklist_task_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "checklist_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Checklist execução: append-only (food-safety, reusa fiscal_append_only) =====
GRANT SELECT, INSERT ON checklist_runs, checklist_task_results TO gelato_app;
DROP TRIGGER IF EXISTS checklist_runs_append_only ON checklist_runs;
CREATE TRIGGER checklist_runs_append_only BEFORE UPDATE OR DELETE ON checklist_runs
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
DROP TRIGGER IF EXISTS checklist_task_results_append_only ON checklist_task_results;
CREATE TRIGGER checklist_task_results_append_only BEFORE UPDATE OR DELETE ON checklist_task_results
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
