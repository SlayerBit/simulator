-- DropForeignKey
ALTER TABLE "FailureEvent" DROP CONSTRAINT "FailureEvent_simulationId_fkey";

-- DropForeignKey
ALTER TABLE "RecoveryAction" DROP CONSTRAINT "RecoveryAction_simulationId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_simulationId_fkey";

-- DropForeignKey
ALTER TABLE "RollbackEntry" DROP CONSTRAINT "RollbackEntry_simulationId_fkey";

-- DropForeignKey
ALTER TABLE "Schedule" DROP CONSTRAINT "Schedule_templateId_fkey";

-- DropForeignKey
ALTER TABLE "SimulationStep" DROP CONSTRAINT "SimulationStep_simulationId_fkey";

-- AddForeignKey
ALTER TABLE "SimulationStep" ADD CONSTRAINT "SimulationStep_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureEvent" ADD CONSTRAINT "FailureEvent_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryAction" ADD CONSTRAINT "RecoveryAction_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RollbackEntry" ADD CONSTRAINT "RollbackEntry_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
