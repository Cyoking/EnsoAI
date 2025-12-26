import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { IPC_CHANNELS } from '@shared/types';
import { ipcMain } from 'electron';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { MCP_TOOLS } from './mcpTools';

interface LockFilePayload {
  pid: number;
  workspaceFolders: string[];
  ideName: string;
  transport: string;
  runningInWindows: boolean;
  authToken: string;
}

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface ClaudeIdeBridgeOptions {
  workspaceFolders?: string[];
  ideName?: string;
}

interface SelectionChangedParams {
  text: string;
  filePath: string;
  fileUrl: string;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
    isEmpty: boolean;
  };
}

interface AtMentionedParams {
  filePath: string;
  lineStart: number;
  lineEnd: number;
}

interface ClaudeIdeBridgeInstance {
  port: number;
  authToken: string;
  lockPath: string;
  workspaceFolders: string[];
  setEnvForChild: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  updateWorkspaceFolders: (folders: string[]) => void;
  sendSelectionChanged: (params: SelectionChangedParams) => void;
  sendAtMentioned: (params: AtMentionedParams) => void;
  dispose: () => void;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function getIdeDir(): string {
  if (process.env.CLAUDE_CONFIG_DIR) {
    return path.join(process.env.CLAUDE_CONFIG_DIR, 'ide');
  }
  return path.join(os.homedir(), '.claude', 'ide');
}

function writeLockFile({
  port,
  authToken,
  workspaceFolders = [],
  ideName = 'EnsoAI',
}: {
  port: number;
  authToken: string;
  workspaceFolders?: string[];
  ideName?: string;
}): string {
  const ideDir = getIdeDir();
  ensureDir(ideDir);

  const lockPath = path.join(ideDir, `${port}.lock`);
  const payload: LockFilePayload = {
    pid: process.pid,
    workspaceFolders,
    ideName,
    transport: 'ws',
    runningInWindows: process.platform === 'win32',
    authToken,
  };

  fs.writeFileSync(lockPath, JSON.stringify(payload), { mode: 0o600 });
  return lockPath;
}

function deleteLockFile(port: number): void {
  const lockPath = path.join(getIdeDir(), `${port}.lock`);
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Ignore errors
  }
}

function safeJsonParse(s: string): JsonRpcRequest | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function createJsonRpcHandler({ ideName }: { ideName: string }) {
  let initialized = false;

  function reply(ws: WebSocket, id: number | string, result: unknown): void {
    const response = { jsonrpc: '2.0', id, result };
    console.log('[ClaudeIdeBridge] >>> OUT:', JSON.stringify(response));
    ws.send(JSON.stringify(response));
  }

  function error(ws: WebSocket, id: number | string, code: number, message: string): void {
    const response = { jsonrpc: '2.0', id, error: { code, message } };
    console.log('[ClaudeIdeBridge] >>> OUT:', JSON.stringify(response));
    ws.send(JSON.stringify(response));
  }

  return async function onMessage(ws: WebSocket, raw: RawData): Promise<void> {
    const rawStr = raw.toString('utf-8');
    console.log('[ClaudeIdeBridge] <<< IN:', rawStr);
    const msg = safeJsonParse(rawStr);
    if (!msg || msg.jsonrpc !== '2.0') return;

    // Notification (no id)
    if (!('id' in msg) || msg.id === undefined) {
      if (msg.method === 'notifications/initialized') {
        initialized = true;
      }
      // ide_connected is just a notification, no response needed
      if (msg.method === 'ide_connected') {
        console.log('[ClaudeIdeBridge] Claude Code connected, pid:', msg.params?.pid);
      }
      return;
    }

    const { id, method, params } = msg;

    if (method === 'ping') {
      return reply(ws, id, {});
    }

    if (method === 'initialize') {
      return reply(ws, id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          logging: {},
          prompts: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          tools: { listChanged: true },
        },
        serverInfo: { name: ideName, version: '0.0.1' },
      });
    }

    if (!initialized && method !== 'ping') {
      return error(ws, id, -32002, 'Server not initialized');
    }

    if (method === 'tools/list') {
      return reply(ws, id, { tools: MCP_TOOLS });
    }

    if (method === 'prompts/list') {
      return reply(ws, id, { prompts: [] });
    }

    if (method === 'resources/list') {
      return reply(ws, id, { resources: [] });
    }

    if (method === 'tools/call') {
      const toolName = params?.name as string | undefined;
      return error(ws, id, -32601, `Tool not found: ${toolName}`);
    }

    return error(ws, id, -32601, `Method not found: ${method}`);
  };
}

export async function startClaudeIdeBridge(
  options: ClaudeIdeBridgeOptions = {}
): Promise<ClaudeIdeBridgeInstance> {
  const { workspaceFolders: initialFolders = [], ideName = 'EnsoAI' } = options;
  const authToken = crypto.randomUUID();

  // Mutable state for workspace folders
  let currentWorkspaceFolders = [...initialFolders];

  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer });

  const jsonRpcHandler = createJsonRpcHandler({ ideName });

  let currentClient: WebSocket | null = null;

  // Function to send notifications to Claude Code
  function sendNotification(method: string, params: object): void {
    if (currentClient && currentClient.readyState === 1) {
      // OPEN = 1
      const message = JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
      });
      console.log('[ClaudeIdeBridge] >>> NOTIFY:', message);
      currentClient.send(message);
    }
  }

  // Register IPC handlers for selection/mention notifications from renderer
  ipcMain.on(IPC_CHANNELS.MCP_SELECTION_CHANGED, (_, params: SelectionChangedParams) => {
    sendNotification('selection_changed', params);
  });

  ipcMain.on(IPC_CHANNELS.MCP_AT_MENTIONED, (_, params: AtMentionedParams) => {
    sendNotification('at_mentioned', params);
  });

  wss.on('connection', (ws, req) => {
    const token = req.headers['x-claude-code-ide-authorization'];
    if (token !== authToken) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    // Only keep one client
    if (currentClient && currentClient !== ws) {
      try {
        currentClient.close();
      } catch {
        // Ignore
      }
    }
    currentClient = ws;

    ws.on('message', (data) => jsonRpcHandler(ws, data));
    ws.on('close', () => {
      if (currentClient === ws) currentClient = null;
    });
  });

  // Listen on random port
  const port = await new Promise<number>((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Failed to get server port'));
      }
    });
    httpServer.on('error', reject);
  });

  const lockPath = writeLockFile({
    port,
    authToken,
    workspaceFolders: currentWorkspaceFolders,
    ideName,
  });

  console.log(`[ClaudeIdeBridge] Started on port ${port}, lock file: ${lockPath}`);

  return {
    port,
    authToken,
    lockPath,
    get workspaceFolders() {
      return currentWorkspaceFolders;
    },
    setEnvForChild(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
      return {
        ...env,
        CLAUDE_CODE_SSE_PORT: String(port),
        ENABLE_IDE_INTEGRATION: 'true',
      };
    },
    updateWorkspaceFolders(folders: string[]): void {
      currentWorkspaceFolders = [...folders];
      writeLockFile({ port, authToken, workspaceFolders: currentWorkspaceFolders, ideName });
      console.log(`[ClaudeIdeBridge] Updated workspaceFolders:`, currentWorkspaceFolders);
    },
    // Send selection_changed notification to Claude Code
    sendSelectionChanged(params: {
      text: string;
      filePath: string;
      fileUrl: string;
      selection: {
        start: { line: number; character: number };
        end: { line: number; character: number };
        isEmpty: boolean;
      };
    }): void {
      sendNotification('selection_changed', params);
    },
    // Send at_mentioned notification to Claude Code
    sendAtMentioned(params: { filePath: string; lineStart: number; lineEnd: number }): void {
      sendNotification('at_mentioned', params);
    },
    dispose(): void {
      deleteLockFile(port);
      try {
        wss.close();
      } catch {
        // Ignore
      }
      try {
        httpServer.close();
      } catch {
        // Ignore
      }
      console.log('[ClaudeIdeBridge] Disposed');
    },
  };
}

// Singleton instance
let bridgeInstance: ClaudeIdeBridgeInstance | null = null;

export async function initClaudeIdeBridge(
  options?: ClaudeIdeBridgeOptions
): Promise<ClaudeIdeBridgeInstance> {
  if (bridgeInstance) {
    return bridgeInstance;
  }
  bridgeInstance = await startClaudeIdeBridge(options);
  return bridgeInstance;
}

export function disposeClaudeIdeBridge(): void {
  if (bridgeInstance) {
    bridgeInstance.dispose();
    bridgeInstance = null;
  }
}

export function getClaudeIdeBridge(): ClaudeIdeBridgeInstance | null {
  return bridgeInstance;
}

export function updateClaudeWorkspaceFolders(folders: string[]): void {
  if (bridgeInstance) {
    bridgeInstance.updateWorkspaceFolders(folders);
  }
}

// Dynamic enable/disable based on settings
let bridgeOptions: ClaudeIdeBridgeOptions = { ideName: 'EnsoAI' };

export async function setClaudeBridgeEnabled(
  enabled: boolean,
  workspaceFolders?: string[]
): Promise<boolean> {
  if (enabled) {
    if (!bridgeInstance) {
      bridgeInstance = await startClaudeIdeBridge({
        ...bridgeOptions,
        workspaceFolders: workspaceFolders ?? [],
      });
      console.log('[ClaudeIdeBridge] Enabled');
    } else if (workspaceFolders) {
      // Bridge already running, just update workspaceFolders
      bridgeInstance.updateWorkspaceFolders(workspaceFolders);
    }
    return true;
  } else {
    if (bridgeInstance) {
      bridgeInstance.dispose();
      bridgeInstance = null;
      console.log('[ClaudeIdeBridge] Disabled');
    }
    return false;
  }
}

export function getClaudeBridgeStatus(): { enabled: boolean; port: number | null } {
  return {
    enabled: bridgeInstance !== null,
    port: bridgeInstance?.port ?? null,
  };
}

export function setBridgeOptions(options: ClaudeIdeBridgeOptions): void {
  bridgeOptions = { ...bridgeOptions, ...options };
}

// Register IPC handlers for bridge control
export function registerClaudeBridgeIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.MCP_BRIDGE_SET_ENABLED,
    async (_, enabled: boolean, workspaceFolders?: string[]) => {
      return setClaudeBridgeEnabled(enabled, workspaceFolders);
    }
  );

  ipcMain.handle(IPC_CHANNELS.MCP_BRIDGE_GET_STATUS, () => {
    return getClaudeBridgeStatus();
  });
}
