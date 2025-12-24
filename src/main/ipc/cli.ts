import type { CustomAgent } from '@shared/types';
import { IPC_CHANNELS } from '@shared/types';
import { ipcMain } from 'electron';
import { cliDetector } from '../services/cli/CliDetector';

export function registerCliHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CLI_DETECT, async (_, customAgents?: CustomAgent[]) => {
    return await cliDetector.detectAll(customAgents);
  });

  ipcMain.handle(
    IPC_CHANNELS.CLI_DETECT_ONE,
    async (_, agentId: string, customAgent?: CustomAgent) => {
      return await cliDetector.detectOne(agentId, customAgent);
    }
  );
}
