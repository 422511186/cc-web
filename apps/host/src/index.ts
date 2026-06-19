import { join } from 'path';
import { loadConfig } from './config.js';
import { SessionStore } from './store.js';
import { SSEManager } from './sse.js';
import { SessionWatcher } from './watcher.js';
import { createApp } from './app.js';
import { HostP2PRuntime } from './p2pRuntime.js';
import { loadOrCreateHostP2PState } from './p2pStateStore.js';

async function main() {
  const config = loadConfig();
  const store = new SessionStore(config.claudeProjectsDir);
  const sseManager = new SSEManager(store);
  const watcher = new SessionWatcher(sseManager);

  // Watch all projects - use the .claude/projects/PROJECT_ID path where JSONL files live
  const projects = await store.listProjects();
  for (const project of projects) {
    const projectStoragePath = join(config.claudeProjectsDir, project.id);
    watcher.watchProject(project.id, projectStoragePath);
  }

  const p2pConfig = config.p2p.enabled ? config.p2p : undefined;
  const p2pState = p2pConfig
    ? await loadOrCreateHostP2PState(p2pConfig.stateFile, p2pConfig.hostId)
    : undefined;
  const p2pRuntime = p2pConfig && p2pState
    ? new HostP2PRuntime({
        signalUrl: p2pConfig.signalUrl,
        hostId: p2pConfig.hostId,
        webUrl: p2pConfig.webUrl,
        localApiBaseUrl: `http://127.0.0.1:${config.port}/api`,
        authToken: config.authToken,
        iceLocalAddresses: p2pConfig.iceLocalAddresses,
        pairingTtlMs: p2pConfig.pairingTtlMs,
        hostIdentity: p2pState.identity,
        trustedDeviceStore: p2pState.trustedDeviceStore,
        onTrustedDeviceStoreChanged: (store) => p2pState.saveTrustedDeviceStore(store),
      })
    : undefined;

  const app = createApp(config, store, sseManager, undefined, p2pRuntime);

  // Start server
  const server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
    console.log(`Projects directory: ${config.claudeProjectsDir}`);
    console.log(`Permission mode: ${config.permissionMode}`);
    console.log(`Watching ${projects.length} projects for changes`);
  });

  if (p2pRuntime && p2pConfig) {
    try {
      await p2pRuntime.start();
      console.log(`P2P Signal connected: ${p2pConfig.signalUrl}`);
      console.log(`P2P Host ID: ${p2pConfig.hostId}`);
    } catch (error) {
      console.error('Failed to connect P2P Signal:', error);
    }
  }

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server...');
    await watcher.close();
    await p2pRuntime?.stop();
    sseManager.close();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
