import { init } from './vectors.mjs';
import { syncDocsource } from './sync.mjs';
import { startServer, migrateFiles } from './server.mjs';
import { logger } from './lib/log.mjs';

const log = logger('system');

log.info('Starting Pythia...');
await init();
await migrateFiles();
await syncDocsource();
startServer();
