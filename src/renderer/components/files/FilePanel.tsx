import { useCallback, useEffect, useState } from 'react';
import { GlobalSearchDialog, type SearchMode } from '@/components/search';
import { useEditor } from '@/hooks/useEditor';
import { useFileTree } from '@/hooks/useFileTree';
import { type TerminalKeybinding, useSettingsStore } from '@/stores/settings';
import { EditorArea } from './EditorArea';
import { FileTree } from './FileTree';
import { NewItemDialog } from './NewItemDialog';

// Helper to check if a keyboard event matches a keybinding
function matchesKeybinding(e: KeyboardEvent, binding: TerminalKeybinding): boolean {
  const keyMatches = e.key.toLowerCase() === binding.key.toLowerCase();
  const ctrlMatches = !!binding.ctrl === e.ctrlKey;
  const altMatches = !!binding.alt === e.altKey;
  const shiftMatches = !!binding.shift === e.shiftKey;
  const metaMatches = !!binding.meta === e.metaKey;
  return keyMatches && ctrlMatches && altMatches && shiftMatches && metaMatches;
}

interface FilePanelProps {
  rootPath: string | undefined;
  isActive?: boolean;
}

type NewItemType = 'file' | 'directory' | null;

export function FilePanel({ rootPath, isActive = false }: FilePanelProps) {
  const {
    tree,
    isLoading,
    expandedPaths,
    toggleExpand,
    createFile,
    createDirectory,
    renameItem,
    deleteItem,
    refresh,
  } = useFileTree({ rootPath, enabled: !!rootPath, isActive });

  const {
    tabs,
    activeTab,
    pendingCursor,
    loadFile,
    saveFile,
    closeFile,
    setActiveFile,
    updateFileContent,
    setTabViewState,
    reorderTabs,
    setPendingCursor,
    navigateToFile,
  } = useEditor();

  const [newItemType, setNewItemType] = useState<NewItemType>(null);
  const [newItemParentPath, setNewItemParentPath] = useState<string>('');

  // Global search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('content');

  // Get search keybindings from settings
  const searchKeybindings = useSettingsStore((s) => s.searchKeybindings);

  // Cmd+W: close tab, Cmd+1-9: switch tab, search shortcuts from settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;

      // File search (default: Cmd+P)
      if (matchesKeybinding(e, searchKeybindings.searchFiles)) {
        e.preventDefault();
        setSearchMode('files');
        setSearchOpen(true);
        return;
      }

      // Content search (default: Cmd+Shift+F)
      if (matchesKeybinding(e, searchKeybindings.searchContent)) {
        e.preventDefault();
        setSearchMode('content');
        setSearchOpen(true);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeTab) {
          closeFile(activeTab.path);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = Number.parseInt(e.key, 10) - 1;
        if (index < tabs.length) {
          setActiveFile(tabs[index].path);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, tabs, activeTab, closeFile, setActiveFile, searchKeybindings]);

  // Handle file click (single click = open in editor)
  const handleFileClick = useCallback(
    (path: string) => {
      const existingTab = tabs.find((t) => t.path === path);
      if (existingTab) {
        setActiveFile(path);
      } else {
        loadFile.mutate(path);
      }
    },
    [tabs, setActiveFile, loadFile]
  );

  // Handle tab click
  const handleTabClick = useCallback(
    (path: string) => {
      setActiveFile(path);
    },
    [setActiveFile]
  );

  // Handle tab close
  const handleTabClose = useCallback(
    (path: string) => {
      closeFile(path);
    },
    [closeFile]
  );

  // Handle save
  const handleSave = useCallback(
    (path: string) => {
      saveFile.mutate(path);
    },
    [saveFile]
  );

  // Handle create file
  const handleCreateFile = useCallback((parentPath: string) => {
    setNewItemType('file');
    setNewItemParentPath(parentPath);
  }, []);

  // Handle create directory
  const handleCreateDirectory = useCallback((parentPath: string) => {
    setNewItemType('directory');
    setNewItemParentPath(parentPath);
  }, []);

  // Handle new item confirm
  const handleNewItemConfirm = useCallback(
    async (name: string) => {
      const fullPath = `${newItemParentPath}/${name}`;
      if (newItemType === 'file') {
        await createFile(fullPath);
        // Open the new file
        loadFile.mutate(fullPath);
      } else if (newItemType === 'directory') {
        await createDirectory(fullPath);
      }
      setNewItemType(null);
      setNewItemParentPath('');
    },
    [newItemType, newItemParentPath, createFile, createDirectory, loadFile]
  );

  // Handle rename
  const handleRename = useCallback(
    async (path: string, newName: string) => {
      const parentPath = path.substring(0, path.lastIndexOf('/'));
      const newPath = `${parentPath}/${newName}`;
      await renameItem(path, newPath);
    },
    [renameItem]
  );

  // Handle delete with confirmation
  const handleDelete = useCallback(
    async (path: string) => {
      const confirmed = window.confirm(`Delete "${path.split('/').pop()}"?`);
      if (confirmed) {
        await deleteItem(path);
        // Close tab if open
        closeFile(path);
      }
    },
    [deleteItem, closeFile]
  );

  // Clear pending cursor
  const handleClearPendingCursor = useCallback(() => {
    setPendingCursor(null);
  }, [setPendingCursor]);

  // Handle breadcrumb click - expand path in file tree
  const handleBreadcrumbClick = useCallback(
    (path: string) => {
      if (!rootPath) return;

      // Get all parent paths that need to be expanded
      const relativePath = path.startsWith(rootPath)
        ? path.slice(rootPath.length).replace(/^\//, '')
        : path;

      const parts = relativePath.split('/');
      let currentPath = rootPath;

      // Expand each parent directory
      for (const part of parts) {
        currentPath = `${currentPath}/${part}`;
        if (!expandedPaths.has(currentPath)) {
          toggleExpand(currentPath);
        }
      }
    },
    [rootPath, expandedPaths, toggleExpand]
  );

  // Handle open file from search
  const handleSearchOpenFile = useCallback(
    (path: string, line?: number, column?: number, matchLength?: number) => {
      navigateToFile(path, line, column, matchLength);
    },
    [navigateToFile]
  );

  if (!rootPath) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Please select a worktree first</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* File Tree - left panel */}
      <div className="w-64 shrink-0 border-r">
        <FileTree
          tree={tree}
          expandedPaths={expandedPaths}
          onToggleExpand={toggleExpand}
          onFileClick={handleFileClick}
          onCreateFile={handleCreateFile}
          onCreateDirectory={handleCreateDirectory}
          onRename={handleRename}
          onDelete={handleDelete}
          onRefresh={refresh}
          onOpenSearch={() => {
            setSearchMode('content');
            setSearchOpen(true);
          }}
          isLoading={isLoading}
          rootPath={rootPath}
        />
      </div>

      {/* Editor Area - right panel */}
      <div className="flex-1 overflow-hidden">
        <EditorArea
          tabs={tabs}
          activeTab={activeTab}
          activeTabPath={activeTab?.path ?? null}
          pendingCursor={pendingCursor}
          rootPath={rootPath}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onTabReorder={reorderTabs}
          onContentChange={updateFileContent}
          onViewStateChange={setTabViewState}
          onSave={handleSave}
          onClearPendingCursor={handleClearPendingCursor}
          onBreadcrumbClick={handleBreadcrumbClick}
        />
      </div>

      {/* New Item Dialog */}
      <NewItemDialog
        isOpen={newItemType !== null}
        type={newItemType || 'file'}
        onConfirm={handleNewItemConfirm}
        onCancel={() => {
          setNewItemType(null);
          setNewItemParentPath('');
        }}
      />

      {/* Global Search Dialog */}
      <GlobalSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        rootPath={rootPath}
        initialMode={searchMode}
        onOpenFile={handleSearchOpenFile}
      />
    </div>
  );
}
