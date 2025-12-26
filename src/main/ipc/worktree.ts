import {
  IPC_CHANNELS,
  type WorktreeCreateOptions,
  type WorktreeRemoveOptions,
} from '@shared/types';
import { ipcMain } from 'electron';
import { updateClaudeWorkspaceFolders } from '../services/claude/ClaudeIdeBridge';
import { WorktreeService } from '../services/git/WorktreeService';
import { agentSessionManager } from './agent';
import { stopWatchersInDirectory } from './files';
import { ptyManager } from './terminal';

const worktreeServices = new Map<string, WorktreeService>();

function getWorktreeService(workdir: string): WorktreeService {
  if (!worktreeServices.has(workdir)) {
    worktreeServices.set(workdir, new WorktreeService(workdir));
  }
  return worktreeServices.get(workdir)!;
}

export function clearWorktreeService(workdir: string): void {
  worktreeServices.delete(workdir);
}

export function clearAllWorktreeServices(): void {
  worktreeServices.clear();
}

export function registerWorktreeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WORKTREE_LIST, async (_, workdir: string) => {
    const service = getWorktreeService(workdir);
    return service.list();
  });

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_ADD,
    async (_, workdir: string, options: WorktreeCreateOptions) => {
      const service = getWorktreeService(workdir);
      await service.add(options);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKTREE_REMOVE,
    async (_, workdir: string, options: WorktreeRemoveOptions) => {
      // Stop all resources using the worktree directory before removal
      await stopWatchersInDirectory(options.path);
      ptyManager.destroyByWorkdir(options.path);
      agentSessionManager.stopByWorkdir(options.path);

      // Wait for processes to fully terminate
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const service = getWorktreeService(workdir);
      await service.remove(options);
    }
  );

  ipcMain.handle(IPC_CHANNELS.WORKTREE_ACTIVATE, async (_, worktreePaths: string[]) => {
    updateClaudeWorkspaceFolders(worktreePaths);
  });
}
