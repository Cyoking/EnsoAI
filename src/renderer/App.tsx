import type {
  GitWorktree,
  WorktreeCreateOptions,
  WorktreeMergeCleanupOptions,
  WorktreeMergeOptions,
  WorktreeMergeResult,
} from '@shared/types';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { panelTransition, type Repository, type TabId } from './App/constants';
import {
  getStoredBoolean,
  getStoredTabMap,
  getStoredWorktreeMap,
  getStoredWorktreeOrderMap,
  pathsEqual,
  STORAGE_KEYS,
  saveWorktreeOrderMap,
} from './App/storage';
import { useAppKeyboardShortcuts } from './App/useAppKeyboardShortcuts';
import { usePanelResize } from './App/usePanelResize';
import { ActionPanel } from './components/layout/ActionPanel';
import { MainContent } from './components/layout/MainContent';
import { RepositorySidebar } from './components/layout/RepositorySidebar';
import { TreeSidebar } from './components/layout/TreeSidebar';
import { WorktreePanel } from './components/layout/WorktreePanel';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { UpdateNotification } from './components/UpdateNotification';
import { Button } from './components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from './components/ui/dialog';
import { toastManager } from './components/ui/toast';
import { MergeEditor, MergeWorktreeDialog } from './components/worktree';
import { useEditor } from './hooks/useEditor';
import { useGitBranches, useGitInit } from './hooks/useGit';
import {
  useWorktreeCreate,
  useWorktreeList,
  useWorktreeMerge,
  useWorktreeMergeAbort,
  useWorktreeMergeContinue,
  useWorktreeRemove,
  useWorktreeResolveConflict,
} from './hooks/useWorktree';
import { useI18n } from './i18n';
import { useEditorStore } from './stores/editor';
import { useNavigationStore } from './stores/navigation';
import { useSettingsStore } from './stores/settings';
import { useWorktreeStore } from './stores/worktree';

export default function App() {
  const { t } = useI18n();
  // Per-worktree tab state: { [worktreePath]: TabId }
  const [worktreeTabMap, setWorktreeTabMap] = useState<Record<string, TabId>>(getStoredTabMap);
  // Per-repo worktree state: { [repoPath]: worktreePath }
  const [repoWorktreeMap, setRepoWorktreeMap] =
    useState<Record<string, string>>(getStoredWorktreeMap);
  // Per-repo worktree display order: { [repoPath]: { [worktreePath]: displayOrder } }
  const [worktreeOrderMap, setWorktreeOrderMap] =
    useState<Record<string, Record<string, number>>>(getStoredWorktreeOrderMap);
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [activeWorktree, setActiveWorktree] = useState<GitWorktree | null>(null);

  // Panel collapsed states - initialize from localStorage
  const [repositoryCollapsed, setRepositoryCollapsed] = useState(() =>
    getStoredBoolean(STORAGE_KEYS.REPOSITORY_COLLAPSED, false)
  );
  const [worktreeCollapsed, setWorktreeCollapsed] = useState(() =>
    getStoredBoolean(STORAGE_KEYS.WORKTREE_COLLAPSED, false)
  );

  // Settings dialog state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Action panel state
  const [actionPanelOpen, setActionPanelOpen] = useState(false);

  // Close confirmation dialog state
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  // Merge dialog state
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeWorktree, setMergeWorktree] = useState<GitWorktree | null>(null);
  const [mergeConflicts, setMergeConflicts] = useState<WorktreeMergeResult | null>(null);
  const [pendingMergeOptions, setPendingMergeOptions] = useState<
    | (Required<Pick<WorktreeMergeCleanupOptions, 'worktreePath' | 'sourceBranch'>> &
        Pick<WorktreeMergeCleanupOptions, 'deleteWorktreeAfterMerge' | 'deleteBranchAfterMerge'>)
    | null
  >(null);

  // Layout mode from settings
  const layoutMode = useSettingsStore((s) => s.layoutMode);

  // Panel resize hook
  const { repositoryWidth, worktreeWidth, resizing, handleResizeStart } =
    usePanelResize(layoutMode);

  const worktreeError = useWorktreeStore((s) => s.error);
  const switchEditorWorktree = useEditorStore((s) => s.switchWorktree);
  const clearEditorWorktreeState = useEditorStore((s) => s.clearWorktreeState);

  // Navigation store for terminal -> editor file navigation
  const { pendingNavigation, clearNavigation } = useNavigationStore();
  const { navigateToFile } = useEditor();

  // Handle tab change and persist to worktree tab map
  const handleTabChange = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      // Save tab state for current worktree
      if (activeWorktree?.path) {
        setWorktreeTabMap((prev) => ({
          ...prev,
          [activeWorktree.path]: tab,
        }));
      }
    },
    [activeWorktree]
  );

  // Keyboard shortcuts
  useAppKeyboardShortcuts({
    activeWorktreePath: activeWorktree?.path,
    onTabSwitch: handleTabChange,
    onActionPanelToggle: useCallback(() => setActionPanelOpen((prev) => !prev), []),
  });

  // Handle terminal file link navigation
  useEffect(() => {
    if (!pendingNavigation) return;

    const { path, line, column } = pendingNavigation;

    // Open the file and set cursor position
    navigateToFile(path, line, column);

    // Switch to file tab and update worktree tab map
    setActiveTab('file');
    if (activeWorktree?.path) {
      setWorktreeTabMap((prev) => ({
        ...prev,
        [activeWorktree.path]: 'file',
      }));
    }

    // Clear the navigation request
    clearNavigation();
  }, [pendingNavigation, navigateToFile, clearNavigation, activeWorktree]);

  // Listen for menu actions from main process
  useEffect(() => {
    const cleanup = window.electronAPI.menu.onAction((action) => {
      switch (action) {
        case 'open-settings':
          setSettingsOpen(true);
          break;
        case 'open-action-panel':
          setActionPanelOpen(true);
          break;
      }
    });
    return cleanup;
  }, []);

  // Listen for close request from main process
  useEffect(() => {
    const cleanup = window.electronAPI.app.onCloseRequest(() => {
      setCloseDialogOpen(true);
    });
    return cleanup;
  }, []);

  // Save collapsed states to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.REPOSITORY_COLLAPSED, String(repositoryCollapsed));
  }, [repositoryCollapsed]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WORKTREE_COLLAPSED, String(worktreeCollapsed));
  }, [worktreeCollapsed]);

  // Persist worktree tab map to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WORKTREE_TABS, JSON.stringify(worktreeTabMap));
  }, [worktreeTabMap]);

  // Get worktrees for selected repo (used in columns mode)
  const {
    data: worktrees = [],
    isLoading: worktreesLoading,
    refetch,
  } = useWorktreeList(selectedRepo);

  // Get branches for selected repo
  const { data: branches = [], refetch: refetchBranches } = useGitBranches(selectedRepo);

  // Worktree mutations
  const createWorktreeMutation = useWorktreeCreate();
  const removeWorktreeMutation = useWorktreeRemove();
  const gitInitMutation = useGitInit();

  // Merge mutations
  const mergeMutation = useWorktreeMerge();
  const resolveConflictMutation = useWorktreeResolveConflict();
  const abortMergeMutation = useWorktreeMergeAbort();
  const continueMergeMutation = useWorktreeMergeContinue();

  // Load saved repositories and selection from localStorage
  useEffect(() => {
    const savedRepos = localStorage.getItem(STORAGE_KEYS.REPOSITORIES);
    if (savedRepos) {
      try {
        const parsed = JSON.parse(savedRepos) as Repository[];
        // Migration: fix repo names that contain full paths (Windows compatibility fix)
        let needsMigration = false;
        const migrated = parsed.map((repo) => {
          // If name contains path separators, it's a full path that needs fixing
          if (repo.name.includes('/') || repo.name.includes('\\')) {
            needsMigration = true;
            const fixedName = repo.path.split(/[\\/]/).pop() || repo.path;
            return { ...repo, name: fixedName };
          }
          return repo;
        });
        if (needsMigration) {
          localStorage.setItem(STORAGE_KEYS.REPOSITORIES, JSON.stringify(migrated));
        }
        setRepositories(migrated);
      } catch {
        // ignore
      }
    }

    const savedSelectedRepo = localStorage.getItem(STORAGE_KEYS.SELECTED_REPO);
    if (savedSelectedRepo) {
      setSelectedRepo(savedSelectedRepo);
    }

    // Migration: convert old single worktree to per-repo map
    const oldWorktreePath = localStorage.getItem(STORAGE_KEYS.ACTIVE_WORKTREE);
    const savedWorktreeMap = getStoredWorktreeMap();
    if (oldWorktreePath && savedSelectedRepo && !savedWorktreeMap[savedSelectedRepo]) {
      // Migrate old data to new format
      const migrated = { ...savedWorktreeMap, [savedSelectedRepo]: oldWorktreePath };
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORKTREES, JSON.stringify(migrated));
      setRepoWorktreeMap(migrated);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_WORKTREE);
    }

    // Restore worktree for selected repo
    const worktreeMap = getStoredWorktreeMap();
    const savedWorktreePath = savedSelectedRepo ? worktreeMap[savedSelectedRepo] : null;
    if (savedWorktreePath) {
      // Wait for worktrees to load before setting active worktree.
      setActiveWorktree({ path: savedWorktreePath } as GitWorktree);
    }
  }, []);

  // Save repositories to localStorage
  const saveRepositories = useCallback((repos: Repository[]) => {
    localStorage.setItem(STORAGE_KEYS.REPOSITORIES, JSON.stringify(repos));
    setRepositories(repos);
  }, []);

  // Reorder repositories
  const handleReorderRepositories = useCallback(
    (fromIndex: number, toIndex: number) => {
      const reordered = [...repositories];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      saveRepositories(reordered);
    },
    [repositories, saveRepositories]
  );

  // Reorder worktrees (update display order)
  const handleReorderWorktrees = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!selectedRepo) return;

      // Get current order for this repo
      const currentRepoOrder = worktreeOrderMap[selectedRepo] || {};

      // Sort worktrees by current display order to get the visual order
      const sortedWorktrees = [...worktrees].sort((a, b) => {
        const orderA = currentRepoOrder[a.path] ?? Number.MAX_SAFE_INTEGER;
        const orderB = currentRepoOrder[b.path] ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      });

      // Build new order
      const orderedPaths = sortedWorktrees.map((wt) => wt.path);
      const [movedPath] = orderedPaths.splice(fromIndex, 1);
      orderedPaths.splice(toIndex, 0, movedPath);

      // Create new order map for this repo
      const newRepoOrder: Record<string, number> = {};
      for (let i = 0; i < orderedPaths.length; i++) {
        newRepoOrder[orderedPaths[i]] = i;
      }

      const newOrderMap = { ...worktreeOrderMap, [selectedRepo]: newRepoOrder };
      setWorktreeOrderMap(newOrderMap);
      saveWorktreeOrderMap(newOrderMap);
    },
    [selectedRepo, worktrees, worktreeOrderMap]
  );

  // Sort worktrees by display order for the current repo
  const sortedWorktrees = selectedRepo
    ? [...worktrees].sort((a, b) => {
        const repoOrder = worktreeOrderMap[selectedRepo] || {};
        const orderA = repoOrder[a.path] ?? Number.MAX_SAFE_INTEGER;
        const orderB = repoOrder[b.path] ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      })
    : worktrees;

  // Listen for open path event from CLI (enso command)
  useEffect(() => {
    const cleanup = window.electronAPI.app.onOpenPath((rawPath) => {
      // Normalize the path: remove trailing slashes and any stray quotes (Windows CMD issue)
      const path = rawPath.replace(/[\\/]+$/, '').replace(/^["']|["']$/g, '');
      // Check if repo already exists (using path comparison that handles Windows case-insensitivity)
      const existingRepo = repositories.find((r) => pathsEqual(r.path, path));
      if (existingRepo) {
        setSelectedRepo(existingRepo.path);
      } else {
        // Handle both forward and back slashes for name extraction
        const name = path.split(/[\\/]/).pop() || path;
        const newRepo: Repository = { name, path };
        const updated = [...repositories, newRepo];
        saveRepositories(updated);
        setSelectedRepo(path);
      }
    });
    return cleanup;
  }, [repositories, saveRepositories]);

  // Remove repository from workspace
  const handleRemoveRepository = useCallback(
    (repoPath: string) => {
      const updated = repositories.filter((r) => r.path !== repoPath);
      saveRepositories(updated);
      // Clear selection if removed repo was selected
      if (selectedRepo === repoPath) {
        setSelectedRepo(null);
        setActiveWorktree(null);
      }
    },
    [repositories, saveRepositories, selectedRepo]
  );

  // Save selected repo to localStorage
  useEffect(() => {
    if (selectedRepo) {
      localStorage.setItem(STORAGE_KEYS.SELECTED_REPO, selectedRepo);
    } else {
      localStorage.removeItem(STORAGE_KEYS.SELECTED_REPO);
    }
  }, [selectedRepo]);

  // Save active worktree to per-repo map
  useEffect(() => {
    if (selectedRepo && activeWorktree) {
      setRepoWorktreeMap((prev) => {
        const updated = { ...prev, [selectedRepo]: activeWorktree.path };
        localStorage.setItem(STORAGE_KEYS.ACTIVE_WORKTREES, JSON.stringify(updated));
        return updated;
      });
    } else if (selectedRepo && !activeWorktree) {
      setRepoWorktreeMap((prev) => {
        const updated = { ...prev };
        delete updated[selectedRepo];
        localStorage.setItem(STORAGE_KEYS.ACTIVE_WORKTREES, JSON.stringify(updated));
        return updated;
      });
    }
  }, [selectedRepo, activeWorktree]);

  // Sync editor state with active worktree
  const currentEditorWorktree = useEditorStore((s) => s.currentWorktreePath);
  useEffect(() => {
    const targetPath = activeWorktree?.path ?? null;
    if (targetPath !== currentEditorWorktree) {
      switchEditorWorktree(targetPath);
    }
  }, [activeWorktree, currentEditorWorktree, switchEditorWorktree]);

  // Sync Claude IDE Bridge with active worktree
  const claudeCodeIntegration = useSettingsStore((s) => s.claudeCodeIntegration);
  useEffect(() => {
    if (claudeCodeIntegration.enabled) {
      const folders = activeWorktree ? [activeWorktree.path] : [];
      window.electronAPI.mcp.setEnabled(true, folders);
    } else {
      window.electronAPI.mcp.setEnabled(false);
    }
  }, [claudeCodeIntegration.enabled, activeWorktree]);

  // Sync activeWorktree with loaded worktrees data
  useEffect(() => {
    if (worktrees.length > 0 && activeWorktree) {
      const found = worktrees.find((wt) => wt.path === activeWorktree.path);
      if (found && found !== activeWorktree) {
        setActiveWorktree(found);
      } else if (!found) {
        setActiveWorktree(null);
      }
    }
  }, [worktrees, activeWorktree]);

  const handleSelectRepo = (repoPath: string) => {
    // Save current worktree's tab state before switching
    if (activeWorktree?.path) {
      setWorktreeTabMap((prev) => ({
        ...prev,
        [activeWorktree.path]: activeTab,
      }));
    }

    setSelectedRepo(repoPath);
    // Restore previously selected worktree for this repo
    const savedWorktreePath = repoWorktreeMap[repoPath];
    if (savedWorktreePath) {
      // Set temporary worktree with just the path; full object synced after worktrees load
      setActiveWorktree({ path: savedWorktreePath } as GitWorktree);
      // Restore the tab state for this worktree
      const savedTab = worktreeTabMap[savedWorktreePath] || 'chat';
      setActiveTab(savedTab);
    } else {
      setActiveWorktree(null);
      setActiveTab('chat');
    }
    // Editor state will be synced by useEffect
  };

  const handleSelectWorktree = useCallback(
    (worktree: GitWorktree) => {
      // Save current worktree's tab state before switching
      if (activeWorktree?.path) {
        setWorktreeTabMap((prev) => ({
          ...prev,
          [activeWorktree.path]: activeTab,
        }));
      }

      // Switch to new worktree (editor state will be synced by useEffect)
      setActiveWorktree(worktree);

      // Restore the new worktree's tab state (default to 'chat')
      const savedTab = worktreeTabMap[worktree.path] || 'chat';
      setActiveTab(savedTab);
    },
    [activeWorktree, activeTab, worktreeTabMap]
  );

  // Handle switching worktree by path (used by notification click)
  const handleSwitchWorktreePath = useCallback(
    (worktreePath: string) => {
      const worktree = worktrees.find((wt) => wt.path === worktreePath);
      if (worktree) {
        handleSelectWorktree(worktree);
      }
    },
    [worktrees, handleSelectWorktree]
  );

  const handleAddRepository = async () => {
    try {
      const selectedPath = await window.electronAPI.dialog.openDirectory();
      if (!selectedPath) return;

      // Check if repo already exists
      if (repositories.some((r) => r.path === selectedPath)) {
        return;
      }

      // Extract repo name from path (handle both / and \ for Windows compatibility)
      const name = selectedPath.split(/[\\/]/).pop() || selectedPath;

      const newRepo: Repository = {
        name,
        path: selectedPath,
      };

      const updated = [...repositories, newRepo];
      saveRepositories(updated);

      // Auto-select the new repo
      setSelectedRepo(selectedPath);
    } catch (error) {
      console.error('Error opening directory dialog:', error);
    }
  };

  const handleCreateWorktree = async (options: WorktreeCreateOptions) => {
    if (!selectedRepo) return;
    try {
      await createWorktreeMutation.mutateAsync({
        workdir: selectedRepo,
        options,
      });
    } finally {
      // Refresh branches on success/failure (git worktree add -b creates branches first).
      refetchBranches();
    }
  };

  const handleRemoveWorktree = async (
    worktree: GitWorktree,
    options?: { deleteBranch?: boolean; force?: boolean }
  ) => {
    if (!selectedRepo) return;
    await removeWorktreeMutation.mutateAsync({
      workdir: selectedRepo,
      options: {
        path: worktree.path,
        force: worktree.prunable || options?.force, // prunable or user-selected force delete
        deleteBranch: options?.deleteBranch,
        branch: worktree.branch || undefined,
      },
    });
    // Clear editor state for the removed worktree
    clearEditorWorktreeState(worktree.path);
    // Clear selection if the active worktree was removed.
    if (activeWorktree?.path === worktree.path) {
      setActiveWorktree(null);
    }
    refetchBranches();
  };

  const handleInitGit = async () => {
    if (!selectedRepo) return;
    try {
      await gitInitMutation.mutateAsync(selectedRepo);
      // Refresh worktrees and branches after init
      await refetch();
      await refetchBranches();
    } catch (error) {
      console.error('Failed to initialize git repository:', error);
    }
  };

  // Merge handlers
  const handleOpenMergeDialog = (worktree: GitWorktree) => {
    setMergeWorktree(worktree);
    setMergeDialogOpen(true);
  };

  const handleMerge = async (options: WorktreeMergeOptions): Promise<WorktreeMergeResult> => {
    if (!selectedRepo) {
      return { success: false, merged: false, error: 'No repository selected' };
    }
    return mergeMutation.mutateAsync({ workdir: selectedRepo, options });
  };

  const handleMergeConflicts = (result: WorktreeMergeResult, options: WorktreeMergeOptions) => {
    setMergeDialogOpen(false); // Close merge dialog first
    setMergeConflicts(result);
    // Store the merge options for cleanup after conflict resolution
    setPendingMergeOptions({
      worktreePath: options.worktreePath,
      sourceBranch: mergeWorktree?.branch || '',
      deleteWorktreeAfterMerge: options.deleteWorktreeAfterMerge,
      deleteBranchAfterMerge: options.deleteBranchAfterMerge,
    });
  };

  const handleResolveConflict = async (file: string, content: string) => {
    if (!selectedRepo) return;
    await resolveConflictMutation.mutateAsync({
      workdir: selectedRepo,
      resolution: { file, content },
    });
  };

  const handleAbortMerge = async () => {
    if (!selectedRepo) return;
    await abortMergeMutation.mutateAsync({ workdir: selectedRepo });
    setMergeConflicts(null);
    setPendingMergeOptions(null);
    refetch();
  };

  const handleCompleteMerge = async (message: string) => {
    if (!selectedRepo) return;
    const result = await continueMergeMutation.mutateAsync({
      workdir: selectedRepo,
      message,
      cleanupOptions: pendingMergeOptions || undefined,
    });
    if (result.success) {
      // Show warnings if any (combined into a single toast)
      if (result.warnings && result.warnings.length > 0) {
        toastManager.add({
          type: 'warning',
          title: t('Merge completed with warnings'),
          description: result.warnings.join('\n'),
        });
      }
      setMergeConflicts(null);
      setPendingMergeOptions(null);
      refetch();
      refetchBranches();
    }
  };

  const getConflictContent = async (file: string) => {
    if (!selectedRepo) throw new Error('No repository selected');
    return window.electronAPI.worktree.getConflictContent(selectedRepo, file);
  };

  // Combined sidebar width for tree layout
  const treeSidebarWidth = repositoryWidth + worktreeWidth;

  return (
    <div className={`flex h-screen overflow-hidden ${resizing ? 'select-none' : ''}`}>
      {layoutMode === 'tree' ? (
        // Tree Layout: Single sidebar with repos as root nodes and worktrees as children
        <AnimatePresence initial={false}>
          {!repositoryCollapsed && (
            <motion.div
              key="tree-sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: treeSidebarWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={panelTransition}
              className="relative h-full shrink-0 overflow-hidden"
            >
              <TreeSidebar
                repositories={repositories}
                selectedRepo={selectedRepo}
                activeWorktree={activeWorktree}
                worktrees={sortedWorktrees}
                branches={branches}
                isLoading={worktreesLoading}
                isCreating={createWorktreeMutation.isPending}
                error={worktreeError}
                onSelectRepo={handleSelectRepo}
                onSelectWorktree={handleSelectWorktree}
                onAddRepository={handleAddRepository}
                onRemoveRepository={handleRemoveRepository}
                onCreateWorktree={handleCreateWorktree}
                onRemoveWorktree={handleRemoveWorktree}
                onMergeWorktree={handleOpenMergeDialog}
                onReorderRepositories={handleReorderRepositories}
                onReorderWorktrees={handleReorderWorktrees}
                onRefresh={() => {
                  refetch();
                  refetchBranches();
                }}
                onInitGit={handleInitGit}
                onOpenSettings={() => setSettingsOpen(true)}
                collapsed={false}
                onCollapse={() => setRepositoryCollapsed(true)}
              />
              {/* Resize handle */}
              <div
                className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
                onMouseDown={handleResizeStart('repository')}
              />
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        // Columns Layout: Separate repo sidebar and worktree panel
        <>
          {/* Column 1: Repository Sidebar */}
          <AnimatePresence initial={false}>
            {!repositoryCollapsed && (
              <motion.div
                key="repository"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: repositoryWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={panelTransition}
                className="relative h-full shrink-0 overflow-hidden"
              >
                <RepositorySidebar
                  repositories={repositories}
                  selectedRepo={selectedRepo}
                  onSelectRepo={handleSelectRepo}
                  onAddRepository={handleAddRepository}
                  onRemoveRepository={handleRemoveRepository}
                  onReorderRepositories={handleReorderRepositories}
                  onOpenSettings={() => setSettingsOpen(true)}
                  collapsed={false}
                  onCollapse={() => setRepositoryCollapsed(true)}
                />
                {/* Resize handle */}
                <div
                  className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
                  onMouseDown={handleResizeStart('repository')}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Column 2: Worktree Panel */}
          <AnimatePresence initial={false}>
            {!worktreeCollapsed && (
              <motion.div
                key="worktree"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: worktreeWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={panelTransition}
                className="relative h-full shrink-0 overflow-hidden"
              >
                <WorktreePanel
                  worktrees={sortedWorktrees}
                  activeWorktree={activeWorktree}
                  branches={branches}
                  projectName={selectedRepo?.split(/[\\/]/).pop() || ''}
                  isLoading={worktreesLoading}
                  isCreating={createWorktreeMutation.isPending}
                  error={worktreeError}
                  onSelectWorktree={handleSelectWorktree}
                  onCreateWorktree={handleCreateWorktree}
                  onRemoveWorktree={handleRemoveWorktree}
                  onMergeWorktree={handleOpenMergeDialog}
                  onReorderWorktrees={handleReorderWorktrees}
                  onInitGit={handleInitGit}
                  onRefresh={() => {
                    refetch();
                    refetchBranches();
                  }}
                  width={worktreeWidth}
                  collapsed={false}
                  onCollapse={() => setWorktreeCollapsed(true)}
                  repositoryCollapsed={repositoryCollapsed}
                  onExpandRepository={() => setRepositoryCollapsed(false)}
                />
                {/* Resize handle */}
                <div
                  className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
                  onMouseDown={handleResizeStart('worktree')}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Main Content */}
      <MainContent
        activeTab={activeTab}
        onTabChange={handleTabChange}
        repoPath={selectedRepo || undefined}
        worktreePath={activeWorktree?.path}
        repositoryCollapsed={repositoryCollapsed}
        worktreeCollapsed={layoutMode === 'tree' ? repositoryCollapsed : worktreeCollapsed}
        layoutMode={layoutMode}
        onExpandRepository={() => setRepositoryCollapsed(false)}
        onExpandWorktree={
          layoutMode === 'tree'
            ? () => setRepositoryCollapsed(false)
            : () => setWorktreeCollapsed(false)
        }
        onSwitchWorktree={handleSwitchWorktreePath}
      />

      {/* Global Settings Dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* Action Panel */}
      <ActionPanel
        open={actionPanelOpen}
        onOpenChange={setActionPanelOpen}
        repositoryCollapsed={repositoryCollapsed}
        worktreeCollapsed={worktreeCollapsed}
        projectPath={activeWorktree?.path || selectedRepo || undefined}
        repositories={repositories}
        selectedRepoPath={selectedRepo ?? undefined}
        worktrees={worktrees}
        activeWorktreePath={activeWorktree?.path}
        onToggleRepository={() => setRepositoryCollapsed((prev) => !prev)}
        onToggleWorktree={() => setWorktreeCollapsed((prev) => !prev)}
        onOpenSettings={() => setSettingsOpen(true)}
        onSwitchRepo={handleSelectRepo}
        onSwitchWorktree={handleSelectWorktree}
      />

      {/* Update Notification */}
      <UpdateNotification />

      {/* Close Confirmation Dialog */}
      <Dialog
        open={closeDialogOpen}
        onOpenChange={(open) => {
          setCloseDialogOpen(open);
          if (!open) {
            window.electronAPI.app.confirmClose(false);
          }
        }}
      >
        <DialogPopup className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('Confirm exit')}</DialogTitle>
            <DialogDescription>{t('Are you sure you want to exit the app?')}</DialogDescription>
          </DialogHeader>
          <DialogFooter variant="bare">
            <Button
              variant="outline"
              onClick={() => {
                setCloseDialogOpen(false);
                window.electronAPI.app.confirmClose(false);
              }}
            >
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setCloseDialogOpen(false);
                window.electronAPI.app.confirmClose(true);
              }}
            >
              {t('Exit')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Merge Worktree Dialog */}
      {mergeWorktree && (
        <MergeWorktreeDialog
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          worktree={mergeWorktree}
          branches={branches}
          isLoading={mergeMutation.isPending}
          onMerge={handleMerge}
          onConflicts={handleMergeConflicts}
        />
      )}

      {/* Merge Conflict Editor */}
      {mergeConflicts?.conflicts && mergeConflicts.conflicts.length > 0 && (
        <Dialog open={true} onOpenChange={() => {}}>
          <DialogPopup className="h-[90vh] max-w-[95vw] p-0" showCloseButton={false}>
            <MergeEditor
              conflicts={mergeConflicts.conflicts}
              workdir={selectedRepo || ''}
              sourceBranch={mergeWorktree?.branch || undefined}
              onResolve={handleResolveConflict}
              onComplete={handleCompleteMerge}
              onAbort={handleAbortMerge}
              getConflictContent={getConflictContent}
            />
          </DialogPopup>
        </Dialog>
      )}
    </div>
  );
}
