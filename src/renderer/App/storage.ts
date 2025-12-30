import type { TabId } from './constants';

// Storage keys
export const STORAGE_KEYS = {
  REPOSITORIES: 'enso-repositories',
  SELECTED_REPO: 'enso-selected-repo',
  ACTIVE_WORKTREE: 'enso-active-worktree', // deprecated, kept for migration
  ACTIVE_WORKTREES: 'enso-active-worktrees', // per-repo worktree map
  WORKTREE_TABS: 'enso-worktree-tabs',
  WORKTREE_ORDER: 'enso-worktree-order', // per-repo worktree display order map
  REPOSITORY_WIDTH: 'enso-repository-width',
  WORKTREE_WIDTH: 'enso-worktree-width',
  REPOSITORY_COLLAPSED: 'enso-repository-collapsed',
  WORKTREE_COLLAPSED: 'enso-worktree-collapsed',
} as const;

// Helper to get initial value from localStorage
export const getStoredNumber = (key: string, defaultValue: number): number => {
  const saved = localStorage.getItem(key);
  return saved ? Number(saved) : defaultValue;
};

export const getStoredBoolean = (key: string, defaultValue: boolean): boolean => {
  const saved = localStorage.getItem(key);
  return saved !== null ? saved === 'true' : defaultValue;
};

export const getStoredTabMap = (): Record<string, TabId> => {
  const saved = localStorage.getItem(STORAGE_KEYS.WORKTREE_TABS);
  if (saved) {
    try {
      return JSON.parse(saved) as Record<string, TabId>;
    } catch {
      return {};
    }
  }
  return {};
};

// Per-repo worktree map: { [repoPath]: worktreePath }
export const getStoredWorktreeMap = (): Record<string, string> => {
  const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_WORKTREES);
  if (saved) {
    try {
      return JSON.parse(saved) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return {};
};

// Per-repo worktree order: { [repoPath]: { [worktreePath]: displayOrder } }
export const getStoredWorktreeOrderMap = (): Record<string, Record<string, number>> => {
  const saved = localStorage.getItem(STORAGE_KEYS.WORKTREE_ORDER);
  if (saved) {
    try {
      return JSON.parse(saved) as Record<string, Record<string, number>>;
    } catch {
      return {};
    }
  }
  return {};
};

export const saveWorktreeOrderMap = (orderMap: Record<string, Record<string, number>>): void => {
  localStorage.setItem(STORAGE_KEYS.WORKTREE_ORDER, JSON.stringify(orderMap));
};

// Normalize path for comparison (handles Windows case-insensitivity and trailing slashes)
export const normalizePath = (path: string): string => {
  // Remove trailing slashes/backslashes
  let normalized = path.replace(/[\\/]+$/, '');
  // On Windows, normalize to lowercase for case-insensitive comparison
  if (navigator.platform.startsWith('Win')) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
};

// Check if two paths are equal (considering OS-specific rules)
export const pathsEqual = (path1: string, path2: string): boolean => {
  return normalizePath(path1) === normalizePath(path2);
};
