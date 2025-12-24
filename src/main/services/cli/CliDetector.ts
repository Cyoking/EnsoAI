import { exec } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentCliInfo, AgentCliStatus, BuiltinAgentId, CustomAgent } from '@shared/types';

const execAsync = promisify(exec);

interface BuiltinAgentConfig {
  id: BuiltinAgentId;
  name: string;
  command: string;
  versionFlag: string;
  versionRegex?: RegExp;
}

const BUILTIN_AGENT_CONFIGS: BuiltinAgentConfig[] = [
  {
    id: 'claude',
    name: 'Claude',
    command: 'claude',
    versionFlag: '--version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    versionFlag: '--version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    id: 'droid',
    name: 'Droid',
    command: 'droid',
    versionFlag: '--version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    command: 'gemini',
    versionFlag: '--version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    id: 'auggie',
    name: 'Auggie',
    command: 'auggie',
    versionFlag: '--version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
];

class CliDetector {
  private cachedStatus: AgentCliStatus | null = null;

  private getEnhancedPath(): string {
    const home = process.env.HOME || '';
    const paths = [
      process.env.PATH || '',
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${home}/.local/bin`,
      `${home}/.volta/bin`,
      ...this.getNvmNodeBins(home),
    ];
    return paths.join(':');
  }

  private getNvmNodeBins(home: string): string[] {
    const nvmVersionsDir = join(home, '.nvm/versions/node');
    try {
      const versions = readdirSync(nvmVersionsDir);
      return versions.map((v) => join(nvmVersionsDir, v, 'bin'));
    } catch {
      return [];
    }
  }

  async detectBuiltin(config: BuiltinAgentConfig): Promise<AgentCliInfo> {
    try {
      const { stdout } = await execAsync(`${config.command} ${config.versionFlag}`, {
        timeout: 5000,
        env: {
          ...process.env,
          PATH: this.getEnhancedPath(),
        },
      });

      let version: string | undefined;
      if (config.versionRegex) {
        const match = stdout.match(config.versionRegex);
        version = match ? match[1] : undefined;
      }

      return {
        id: config.id,
        name: config.name,
        command: config.command,
        installed: true,
        version,
        isBuiltin: true,
      };
    } catch {
      return {
        id: config.id,
        name: config.name,
        command: config.command,
        installed: false,
        isBuiltin: true,
      };
    }
  }

  async detectCustom(agent: CustomAgent): Promise<AgentCliInfo> {
    try {
      const { stdout } = await execAsync(`${agent.command} --version`, {
        timeout: 5000,
        env: {
          ...process.env,
          PATH: this.getEnhancedPath(),
        },
      });

      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      const version = match ? match[1] : undefined;

      return {
        id: agent.id,
        name: agent.name,
        command: agent.command,
        installed: true,
        version,
        isBuiltin: false,
      };
    } catch {
      return {
        id: agent.id,
        name: agent.name,
        command: agent.command,
        installed: false,
        isBuiltin: false,
      };
    }
  }

  async detectOne(agentId: string, customAgent?: CustomAgent): Promise<AgentCliInfo> {
    const builtinConfig = BUILTIN_AGENT_CONFIGS.find((c) => c.id === agentId);
    if (builtinConfig) {
      return this.detectBuiltin(builtinConfig);
    }
    if (customAgent) {
      return this.detectCustom(customAgent);
    }
    return {
      id: agentId,
      name: agentId,
      command: agentId,
      installed: false,
      isBuiltin: false,
    };
  }

  async detectAll(customAgents: CustomAgent[] = []): Promise<AgentCliStatus> {
    const builtinPromises = BUILTIN_AGENT_CONFIGS.map((config) => this.detectBuiltin(config));
    const customPromises = customAgents.map((agent) => this.detectCustom(agent));

    const agents = await Promise.all([...builtinPromises, ...customPromises]);

    this.cachedStatus = { agents };
    return this.cachedStatus;
  }

  getCached(): AgentCliStatus | null {
    return this.cachedStatus;
  }
}

export const cliDetector = new CliDetector();
