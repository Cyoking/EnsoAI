import { useCallback, useEffect, useMemo, useState } from 'react';
import { BUILTIN_AGENT_IDS, useSettingsStore } from '@/stores/settings';
import { AgentTerminal } from './AgentTerminal';
import { type Session, SessionBar } from './SessionBar';

interface AgentPanelProps {
  repoPath: string; // repository path (workspace identifier)
  cwd: string; // current worktree path
  isActive?: boolean;
}

const SESSIONS_STORAGE_PREFIX = 'enso-chat-sessions:';

// Agent display names and commands
const AGENT_INFO: Record<string, { name: string; command: string }> = {
  claude: { name: 'Claude', command: 'claude' },
  codex: { name: 'Codex', command: 'codex' },
  droid: { name: 'Droid', command: 'droid' },
  gemini: { name: 'Gemini', command: 'gemini' },
  auggie: { name: 'Auggie', command: 'auggie' },
};

function getDefaultAgentId(
  agentSettings: Record<string, { enabled: boolean; isDefault: boolean }>
): string {
  // Find the default agent
  for (const [id, config] of Object.entries(agentSettings)) {
    if (config.isDefault && config.enabled) {
      return id;
    }
  }
  // Fallback to first enabled builtin agent
  for (const id of BUILTIN_AGENT_IDS) {
    if (agentSettings[id]?.enabled) {
      return id;
    }
  }
  // Ultimate fallback
  return 'claude';
}

function createSession(
  cwd: string,
  agentId: string,
  customAgents: Array<{ id: string; name: string; command: string }>
): Session {
  // Check if it's a custom agent
  const customAgent = customAgents.find((a) => a.id === agentId);
  const info = customAgent
    ? { name: customAgent.name, command: customAgent.command }
    : AGENT_INFO[agentId] || { name: 'Claude', command: 'claude' };

  return {
    id: crypto.randomUUID(),
    name: info.name,
    agentId,
    agentCommand: info.command,
    initialized: false,
    cwd,
  };
}

function loadSessions(repoPath: string): {
  sessions: Session[];
  activeIds: Record<string, string | null>;
} {
  try {
    const saved = localStorage.getItem(SESSIONS_STORAGE_PREFIX + repoPath);
    if (saved) {
      const data = JSON.parse(saved);
      if (data.sessions?.length > 0) {
        return { sessions: data.sessions, activeIds: data.activeIds || {} };
      }
    }
  } catch {}
  return { sessions: [], activeIds: {} };
}

// Agents that support session persistence
const RESUMABLE_AGENTS = new Set(['claude']);

function saveSessions(
  repoPath: string,
  sessions: Session[],
  activeIds: Record<string, string | null>
): void {
  // Only persist sessions for agents that support resumption
  const persistableSessions = sessions.filter((s) => RESUMABLE_AGENTS.has(s.agentCommand));
  localStorage.setItem(
    SESSIONS_STORAGE_PREFIX + repoPath,
    JSON.stringify({ sessions: persistableSessions, activeIds })
  );
}

export function AgentPanel({ repoPath, cwd, isActive = false }: AgentPanelProps) {
  const { agentSettings, customAgents } = useSettingsStore();
  const defaultAgentId = useMemo(() => getDefaultAgentId(agentSettings), [agentSettings]);

  const [state, setState] = useState(() => {
    const loaded = loadSessions(repoPath);
    // Create initial session for current worktree if none exists
    const hasSessionForCwd = loaded.sessions.some((s) => s.cwd === cwd);
    if (!hasSessionForCwd && cwd) {
      const agentId = getDefaultAgentId(agentSettings);
      const newSession = createSession(cwd, agentId, customAgents);
      return {
        sessions: [...loaded.sessions, newSession],
        activeIds: { ...loaded.activeIds, [cwd]: newSession.id },
      };
    }
    return { sessions: loaded.sessions, activeIds: loaded.activeIds };
  });
  const allSessions = state.sessions;
  const activeIds = state.activeIds;

  // Get current worktree's active session id (fallback to first session if not set)
  const activeSessionId = activeIds[cwd] || allSessions.find((s) => s.cwd === cwd)?.id || null;

  // Filter sessions for current worktree (for SessionBar display)
  const currentWorktreeSessions = useMemo(() => {
    return allSessions.filter((s) => s.cwd === cwd);
  }, [allSessions, cwd]);

  // Create initial session when switching to a new worktree
  useEffect(() => {
    if (currentWorktreeSessions.length === 0 && cwd) {
      setState((prev) => {
        // Double check to prevent duplicates
        if (prev.sessions.some((s) => s.cwd === cwd)) return prev;
        const newSession = createSession(cwd, defaultAgentId, customAgents);
        return {
          sessions: [...prev.sessions, newSession],
          activeIds: { ...prev.activeIds, [cwd]: newSession.id },
        };
      });
    }
  }, [cwd, currentWorktreeSessions.length, defaultAgentId, customAgents]);

  // Persist sessions on change
  useEffect(() => {
    saveSessions(repoPath, allSessions, activeIds);
  }, [repoPath, allSessions, activeIds]);

  const handleNewSession = useCallback(() => {
    const newSession = createSession(cwd, defaultAgentId, customAgents);
    setState((prev) => ({
      sessions: [...prev.sessions, newSession],
      activeIds: { ...prev.activeIds, [cwd]: newSession.id },
    }));
  }, [cwd, defaultAgentId, customAgents]);

  const handleCloseSession = useCallback(
    (id: string) => {
      setState((prev) => {
        const session = prev.sessions.find((s) => s.id === id);
        if (!session) return prev;

        const worktreeCwd = session.cwd;
        const newSessions = prev.sessions.filter((s) => s.id !== id);
        const remainingInWorktree = newSessions.filter((s) => s.cwd === worktreeCwd);

        const newActiveIds = { ...prev.activeIds };

        // If closing active session in this worktree, switch to another
        if (prev.activeIds[worktreeCwd] === id) {
          if (remainingInWorktree.length > 0) {
            const closedIndex = prev.sessions
              .filter((s) => s.cwd === worktreeCwd)
              .findIndex((s) => s.id === id);
            const newActiveIndex = Math.min(closedIndex, remainingInWorktree.length - 1);
            newActiveIds[worktreeCwd] = remainingInWorktree[newActiveIndex].id;
          } else {
            // Create a new session if all closed in this worktree
            const newSession = createSession(worktreeCwd, defaultAgentId, customAgents);
            return {
              sessions: [...newSessions, newSession],
              activeIds: { ...newActiveIds, [worktreeCwd]: newSession.id },
            };
          }
        }

        return { sessions: newSessions, activeIds: newActiveIds };
      });
    },
    [defaultAgentId, customAgents]
  );

  const handleSelectSession = useCallback((id: string) => {
    setState((prev) => {
      const session = prev.sessions.find((s) => s.id === id);
      if (!session) return prev;
      return { ...prev, activeIds: { ...prev.activeIds, [session.cwd]: id } };
    });
  }, []);

  const handleInitialized = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, initialized: true } : s)),
    }));
  }, []);

  const handleRenameSession = useCallback((id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, name } : s)),
    }));
  }, []);

  const handleNewSessionWithAgent = useCallback(
    (agentId: string, agentCommand: string) => {
      // Get agent name for display
      const customAgent = customAgents.find((a) => a.id === agentId);
      const name = customAgent?.name ?? AGENT_INFO[agentId]?.name ?? 'Agent';

      const newSession: Session = {
        id: crypto.randomUUID(),
        name,
        agentId,
        agentCommand,
        initialized: false,
        cwd,
      };

      setState((prev) => ({
        sessions: [...prev.sessions, newSession],
        activeIds: { ...prev.activeIds, [cwd]: newSession.id },
      }));
    },
    [cwd, customAgents]
  );

  // Cmd+T: new session, Cmd+W: close session, Cmd+1-9: switch session
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        handleNewSession();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeSessionId) {
          handleCloseSession(activeSessionId);
        }
      }
      // Cmd+1-9 to switch sessions
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = Number.parseInt(e.key, 10) - 1;
        if (index < currentWorktreeSessions.length) {
          handleSelectSession(currentWorktreeSessions[index].id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isActive,
    activeSessionId,
    currentWorktreeSessions,
    handleNewSession,
    handleCloseSession,
    handleSelectSession,
  ]);

  return (
    <div className="relative h-full w-full">
      {/* Render all terminals across all worktrees, keep them mounted */}
      {allSessions.map((session) => {
        const isSessionActive = session.cwd === cwd && activeSessionId === session.id;
        return (
          <div
            key={session.id}
            className={isSessionActive ? 'h-full w-full' : 'invisible absolute inset-0'}
          >
            <AgentTerminal
              cwd={session.cwd}
              sessionId={session.id}
              agentCommand={session.agentCommand || 'claude'}
              initialized={session.initialized}
              isActive={isSessionActive}
              onInitialized={() => handleInitialized(session.id)}
              onExit={() => handleCloseSession(session.id)}
            />
          </div>
        );
      })}

      {/* Floating session bar - shows only current worktree's sessions */}
      <SessionBar
        sessions={currentWorktreeSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onCloseSession={handleCloseSession}
        onNewSession={handleNewSession}
        onNewSessionWithAgent={handleNewSessionWithAgent}
        onRenameSession={handleRenameSession}
      />
    </div>
  );
}
