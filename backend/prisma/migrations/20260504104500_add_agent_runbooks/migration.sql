CREATE TABLE "AgentRunbook" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "incidentType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'agent1-live',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunbook_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AgentRunbook"
ADD CONSTRAINT "AgentRunbook_simulationId_fkey"
FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AgentRunbook_simulationId_createdAt_idx" ON "AgentRunbook"("simulationId", "createdAt");
