-- 1. Ensure RollbackEntry exists (Missing from previous migration)
CREATE TABLE IF NOT EXISTS "RollbackEntry" (
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

-- 2. Safely remove any existing constraints (Avoid "not exist" or "already exists" errors)
ALTER TABLE "SimulationStep" DROP CONSTRAINT IF EXISTS "SimulationStep_simulationId_fkey";
ALTER TABLE "FailureEvent" DROP CONSTRAINT IF EXISTS "FailureEvent_simulationId_fkey";
ALTER TABLE "RecoveryAction" DROP CONSTRAINT IF EXISTS "RecoveryAction_simulationId_fkey";
ALTER TABLE "Report" DROP CONSTRAINT IF EXISTS "Report_simulationId_fkey";
ALTER TABLE "Schedule" DROP CONSTRAINT IF EXISTS "Schedule_templateId_fkey";
ALTER TABLE "RollbackEntry" DROP CONSTRAINT IF EXISTS "RollbackEntry_simulationId_fkey";

-- 3. Re-apply all constraints with ON DELETE CASCADE
ALTER TABLE "SimulationStep" ADD CONSTRAINT "SimulationStep_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FailureEvent" ADD CONSTRAINT "FailureEvent_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecoveryAction" ADD CONSTRAINT "RecoveryAction_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RollbackEntry" ADD CONSTRAINT "RollbackEntry_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Final adjustments (Fix Schedule setting templateId to CASCADE instead of RESTRICT)
ALTER TABLE "Schedule" DROP CONSTRAINT IF EXISTS "Schedule_templateId_fkey";
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
