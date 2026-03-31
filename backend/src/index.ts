import { loadDotenvIfNeeded } from './config/load-dotenv.js';
import { loadConfig } from './config/env.js';
import { startScheduler } from './scheduling/service.js';
import { startSimulationWorker } from './simulations/service.js';
import { ensureDefaultAdmin } from './auth/service.js';
import { createApp } from './app.js';

loadDotenvIfNeeded();
const config = loadConfig();
const app = createApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Simulator backend listening on port ${config.port}`);
});

console.log("Starting simulation worker...");
startSimulationWorker().catch((e) => {
  console.error("Worker crashed on startup:", e);
});

void startScheduler().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Scheduler failed to start', e);
});

void ensureDefaultAdmin().catch((e) => {
  console.error('Failed to seed default admin', e);
});
