import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Session } from '@/components/chat/SessionBar';

// Global storage key for all sessions across all repos
const SESSIONS_STORAGE_KEY = 'enso-agent-sessions';

// Agents that support session persistence
const RESUMABLE_AGENTS = new Set(['claude']);

interface AgentSessionsState {
  sessions: Session[];
  activeIds: Record<string, string | null>; // key = cwd (worktree path)

  // Actions
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  setActiveId: (cwd: string, sessionId: string | null) => void;
  reorderSessions: (repoPath: string, cwd: string, fromIndex: number, toIndex: number) => void;
  getSessions: (repoPath: string, cwd: string) => Session[];
  getActiveSessionId: (repoPath: string, cwd: string) => string | null;
}

function loadFromStorage(): { sessions: Session[]; activeIds: Record<string, string | null> } {
  try {
    const saved = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      if (data.sessions?.length > 0) {
        // Migrate old sessions that don't have repoPath (backwards compatibility)
        const migratedSessions = data.sessions.map((s: Session) => ({
          ...s,
          repoPath: s.repoPath || s.cwd,
        }));
        return { sessions: migratedSessions, activeIds: data.activeIds || {} };
      }
    }
  } catch {}
  return { sessions: [], activeIds: {} };
}

function saveToStorage(sessions: Session[], activeIds: Record<string, string | null>): void {
  // Only persist sessions that are:
  // 1. Using agents that support resumption (e.g., claude)
  // 2. Activated (user has pressed Enter at least once)
  const persistableSessions = sessions.filter(
    (s) => RESUMABLE_AGENTS.has(s.agentCommand) && s.activated
  );
  const persistableIds = new Set(persistableSessions.map((s) => s.id));
  // Only keep activeIds that reference persistable sessions
  const persistableActiveIds: Record<string, string | null> = {};
  for (const [cwd, id] of Object.entries(activeIds)) {
    persistableActiveIds[cwd] = id && persistableIds.has(id) ? id : null;
  }
  localStorage.setItem(
    SESSIONS_STORAGE_KEY,
    JSON.stringify({ sessions: persistableSessions, activeIds: persistableActiveIds })
  );
}

const initialState = loadFromStorage();

export const useAgentSessionsStore = create<AgentSessionsState>()(
  subscribeWithSelector((set, get) => ({
    sessions: initialState.sessions,
    activeIds: initialState.activeIds,

    addSession: (session) =>
      set((state) => {
        // Calculate displayOrder: max order in same worktree + 1
        const worktreeSessions = state.sessions.filter(
          (s) => s.repoPath === session.repoPath && s.cwd === session.cwd
        );
        const maxOrder = worktreeSessions.reduce(
          (max, s) => Math.max(max, s.displayOrder ?? 0),
          -1
        );
        const newSession = { ...session, displayOrder: maxOrder + 1 };
        return {
          sessions: [...state.sessions, newSession],
          activeIds: { ...state.activeIds, [session.cwd]: session.id },
        };
      }),

    removeSession: (id) =>
      set((state) => {
        const newSessions = state.sessions.filter((s) => s.id !== id);
        return { sessions: newSessions };
      }),

    updateSession: (id, updates) =>
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      })),

    setActiveId: (cwd, sessionId) =>
      set((state) => ({
        activeIds: { ...state.activeIds, [cwd]: sessionId },
      })),

    reorderSessions: (repoPath, cwd, fromIndex, toIndex) =>
      set((state) => {
        // Get sessions for current worktree, sorted by displayOrder
        const worktreeSessions = state.sessions
          .filter((s) => s.repoPath === repoPath && s.cwd === cwd)
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

        if (fromIndex < 0 || fromIndex >= worktreeSessions.length) return state;
        if (toIndex < 0 || toIndex >= worktreeSessions.length) return state;

        // Build new order array
        const orderedIds = worktreeSessions.map((s) => s.id);
        const [movedId] = orderedIds.splice(fromIndex, 1);
        orderedIds.splice(toIndex, 0, movedId);

        // Create id -> new displayOrder map
        const newOrderMap = new Map<string, number>();
        for (let i = 0; i < orderedIds.length; i++) {
          newOrderMap.set(orderedIds[i], i);
        }

        // Update displayOrder for affected sessions only (don't reorder array)
        return {
          sessions: state.sessions.map((s) => {
            if (s.repoPath === repoPath && s.cwd === cwd) {
              const newOrder = newOrderMap.get(s.id);
              if (newOrder !== undefined && newOrder !== s.displayOrder) {
                return { ...s, displayOrder: newOrder };
              }
            }
            return s;
          }),
        };
      }),

    getSessions: (repoPath, cwd) => {
      return get()
        .sessions.filter((s) => s.repoPath === repoPath && s.cwd === cwd)
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    },

    getActiveSessionId: (repoPath, cwd) => {
      const state = get();
      const activeId = state.activeIds[cwd];
      if (activeId) {
        // Verify the session exists and matches repoPath
        const session = state.sessions.find((s) => s.id === activeId);
        if (session && session.repoPath === repoPath) {
          return activeId;
        }
      }
      // Fallback to first session for this repo+cwd
      const firstSession = state.sessions.find((s) => s.repoPath === repoPath && s.cwd === cwd);
      return firstSession?.id || null;
    },
  }))
);

// Subscribe to state changes and persist to localStorage
useAgentSessionsStore.subscribe(
  (state) => ({ sessions: state.sessions, activeIds: state.activeIds }),
  ({ sessions, activeIds }) => {
    saveToStorage(sessions, activeIds);
  },
  { equalityFn: (a, b) => a.sessions === b.sessions && a.activeIds === b.activeIds }
);
