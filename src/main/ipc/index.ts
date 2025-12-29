import { disposeClaudeIdeBridge } from '../services/claude/ClaudeIdeBridge';
import { registerAgentHandlers } from './agent';
import { registerAppHandlers } from './app';
import { registerCliHandlers } from './cli';
import { registerDialogHandlers } from './dialog';
import { registerFileHandlers, stopAllFileWatchers } from './files';
import { clearAllGitServices, registerGitHandlers } from './git';
import { autoStartHapi, cleanupHapi, registerHapiHandlers } from './hapi';

export { autoStartHapi };

import { registerNotificationHandlers } from './notification';
import { registerSearchHandlers } from './search';
import { registerSettingsHandlers } from './settings';
import { registerShellHandlers } from './shell';
import {
  destroyAllTerminals,
  destroyAllTerminalsAndWait,
  registerTerminalHandlers,
} from './terminal';
import { registerUpdaterHandlers } from './updater';
import { clearAllWorktreeServices, registerWorktreeHandlers } from './worktree';

export function registerIpcHandlers(): void {
  registerGitHandlers();
  registerWorktreeHandlers();
  registerFileHandlers();
  registerTerminalHandlers();
  registerAgentHandlers();
  registerDialogHandlers();
  registerAppHandlers();
  registerCliHandlers();
  registerShellHandlers();
  registerSettingsHandlers();
  registerNotificationHandlers();
  registerUpdaterHandlers();
  registerSearchHandlers();
  registerHapiHandlers();
}

export async function cleanupAllResources(): Promise<void> {
  const CLEANUP_TIMEOUT = 3000;

  // Stop Hapi server first (sync, fast)
  cleanupHapi();

  // Destroy all PTY sessions and wait for them to exit
  // This prevents crashes when PTY exit callbacks fire during Node cleanup
  try {
    await Promise.race([
      destroyAllTerminalsAndWait(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Terminal cleanup timeout')), CLEANUP_TIMEOUT)
      ),
    ]);
  } catch (err) {
    console.warn('Terminal cleanup warning:', err);
    // Force destroy without waiting as fallback
    destroyAllTerminals();
  }

  // Stop file watchers with timeout to prevent hanging
  try {
    await Promise.race([
      stopAllFileWatchers(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('File watcher cleanup timeout')), CLEANUP_TIMEOUT)
      ),
    ]);
  } catch (err) {
    console.warn('File watcher cleanup warning:', err);
  }

  // Clear service caches (sync, fast)
  clearAllGitServices();
  clearAllWorktreeServices();

  // Dispose Claude IDE Bridge
  disposeClaudeIdeBridge();
}
