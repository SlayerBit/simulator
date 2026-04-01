-- AlterTable
ALTER TABLE "SimulationStep" ADD COLUMN     "command" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "namespace" TEXT,
ADD COLUMN     "resourceName" TEXT,
ADD COLUMN     "resourceType" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'success',
ADD COLUMN     "stepType" TEXT NOT NULL DEFAULT 'execution',
ADD COLUMN     "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "RollbackEntry" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "actionName" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceName" TEXT,
    "namespace" TEXT,
    "snapshotData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RollbackEntry_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RollbackEntry" ADD CONSTRAINT "RollbackEntry_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
