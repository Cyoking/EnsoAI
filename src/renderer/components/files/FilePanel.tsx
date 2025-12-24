import { useCallback, useState } from 'react';
import { useEditor } from '@/hooks/useEditor';
import { useFileTree } from '@/hooks/useFileTree';
import { EditorArea } from './EditorArea';
import { FileTree } from './FileTree';
import { NewItemDialog } from './NewItemDialog';

interface FilePanelProps {
  rootPath: string | undefined;
}

type NewItemType = 'file' | 'directory' | null;

export function FilePanel({ rootPath }: FilePanelProps) {
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
  } = useFileTree({ rootPath, enabled: !!rootPath });

  const {
    tabs,
    activeTab,
    loadFile,
    saveFile,
    closeFile,
    setActiveFile,
    updateFileContent,
    setTabViewState,
    reorderTabs,
  } = useEditor();

  const [newItemType, setNewItemType] = useState<NewItemType>(null);
  const [newItemParentPath, setNewItemParentPath] = useState<string>('');

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
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onTabReorder={reorderTabs}
          onContentChange={updateFileContent}
          onViewStateChange={setTabViewState}
          onSave={handleSave}
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
    </div>
  );
}
