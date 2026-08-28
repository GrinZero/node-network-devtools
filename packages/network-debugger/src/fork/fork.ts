import { runLegacyBridgeHost } from '../legacy-bridge/host'

void runLegacyBridgeHost().catch((error) => {
  // The host already sends a structured startup diagnostic when IPC is
  // available. This remains useful when someone launches the child directly.
  console.error('Legacy bridge child failed:', error)
  process.exitCode = 1
  if (process.connected) process.disconnect()
})
