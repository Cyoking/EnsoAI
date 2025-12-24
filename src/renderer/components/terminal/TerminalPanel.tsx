import { List, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ShellTerminal } from './ShellTerminal';

interface TerminalTab {
  id: string;
  name: string;
}

interface TerminalPanelProps {
  cwd?: string;
  isActive?: boolean;
}

function createInitialState(): { tabs: TerminalTab[]; activeId: string | null } {
  // Start with empty tabs - will create first tab when cwd is available
  return { tabs: [], activeId: null };
}

function getNextName(tabs: TerminalTab[]): string {
  const numbers = tabs
    .map((t) => {
      const match = t.name.match(/^Untitled-(\d+)$/);
      return match ? Number.parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  return `Untitled-${max + 1}`;
}

export function TerminalPanel({ cwd, isActive = false }: TerminalPanelProps) {
  const [state, setState] = useState(createInitialState);
  const { tabs, activeId } = state;
  const inputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // Create initial tab when cwd becomes available
  useEffect(() => {
    if (cwd && !initializedRef.current) {
      initializedRef.current = true;
      const defaultTab = { id: crypto.randomUUID(), name: 'Untitled-1' };
      setState({ tabs: [defaultTab], activeId: defaultTab.id });
    }
  }, [cwd]);

  // Stable terminal IDs - only append, never reorder (prevents DOM reordering issues with xterm)
  const [terminalIds, setTerminalIds] = useState<string[]>(() => tabs.map((t) => t.id));

  // Update stable terminal IDs when tabs change (append new, remove deleted)
  useEffect(() => {
    setTerminalIds((prev) => {
      const currentIds = new Set(prev);
      const tabIds = new Set(tabs.map((t) => t.id));
      // Append new tabs (preserve creation order)
      const newIds = tabs.filter((t) => !currentIds.has(t.id)).map((t) => t.id);
      // Filter out deleted tabs
      const filtered = prev.filter((id) => tabIds.has(id));
      return newIds.length > 0 ? [...filtered, ...newIds] : filtered;
    });
  }, [tabs]);

  const handleNewTab = useCallback(() => {
    setState((prev) => {
      const newTab: TerminalTab = {
        id: crypto.randomUUID(),
        name: getNextName(prev.tabs),
      };
      return {
        tabs: [...prev.tabs, newTab],
        activeId: newTab.id,
      };
    });
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    setState((prev) => {
      const newTabs = prev.tabs.filter((t) => t.id !== id);
      if (newTabs.length === 0) {
        // Always keep at least one tab
        const newTab = { id: crypto.randomUUID(), name: 'Untitled-1' };
        return { tabs: [newTab], activeId: newTab.id };
      }
      let newActiveId = prev.activeId;
      if (prev.activeId === id) {
        const closedIndex = prev.tabs.findIndex((t) => t.id === id);
        const newIndex = Math.min(closedIndex, newTabs.length - 1);
        newActiveId = newTabs[newIndex].id;
      }
      return { tabs: newTabs, activeId: newActiveId };
    });
  }, []);

  const handleSelectTab = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeId: id }));
  }, []);

  // Cmd+T: new tab, Cmd+W: close tab, Cmd+1-9: switch tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        handleNewTab();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeId) {
          handleCloseTab(activeId);
        }
      }
      // Cmd+1-9 to switch tabs
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = Number.parseInt(e.key, 10) - 1;
        if (index < tabs.length) {
          handleSelectTab(tabs[index].id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, activeId, tabs, handleNewTab, handleCloseTab, handleSelectTab]);

  const handleStartEdit = useCallback((tab: TerminalTab) => {
    setEditingId(tab.id);
    setEditingName(tab.name);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const handleFinishEdit = useCallback(() => {
    if (editingId && editingName.trim()) {
      setState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => (t.id === editingId ? { ...t, name: editingName.trim() } : t)),
      }));
    }
    setEditingId(null);
    setEditingName('');
  }, [editingId, editingName]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleFinishEdit();
      } else if (e.key === 'Escape') {
        setEditingId(null);
        setEditingName('');
      }
    },
    [handleFinishEdit]
  );

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDraggedId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
    // Make drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedId(null);
    setDropTargetId(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, tabId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedId && tabId !== draggedId) {
        setDropTargetId(tabId);
      }
    },
    [draggedId]
  );

  const handleDragLeave = useCallback(() => {
    setDropTargetId(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      if (!draggedId || draggedId === targetId) {
        setDraggedId(null);
        setDropTargetId(null);
        return;
      }

      setState((prev) => {
        const draggedIndex = prev.tabs.findIndex((t) => t.id === draggedId);
        const targetIndex = prev.tabs.findIndex((t) => t.id === targetId);
        if (draggedIndex === -1 || targetIndex === -1) return prev;

        const newTabs = [...prev.tabs];
        const [removed] = newTabs.splice(draggedIndex, 1);
        newTabs.splice(targetIndex, 0, removed);
        return { ...prev, tabs: newTabs };
      });

      setDraggedId(null);
      setDropTargetId(null);
    },
    [draggedId]
  );

  return (
    <div className="flex h-full w-full flex-col">
      {/* Tab Bar */}
      <div className="flex h-9 items-center border-b border-border bg-background/50 backdrop-blur-sm">
        <div className="flex flex-1 items-center overflow-x-auto" onDoubleClick={handleNewTab}>
          {tabs.map((tab) => {
            const isActive = activeId === tab.id;
            const isDragging = draggedId === tab.id;
            const isDropTarget = dropTargetId === tab.id;
            return (
              <div
                key={tab.id}
                draggable={editingId !== tab.id}
                onDragStart={(e) => handleDragStart(e, tab.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, tab.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, tab.id)}
                onClick={() => handleSelectTab(tab.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleStartEdit(tab);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSelectTab(tab.id)}
                role="button"
                tabIndex={0}
                className={cn(
                  'group relative flex h-9 min-w-[120px] max-w-[180px] items-center gap-2 border-r border-border px-3 text-sm transition-colors cursor-grab',
                  isActive
                    ? 'bg-background text-foreground'
                    : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  isDragging && 'opacity-50',
                  isDropTarget && 'ring-2 ring-primary ring-inset'
                )}
              >
                <List className="h-3.5 w-3.5 shrink-0 opacity-60" />
                {editingId === tab.id ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleFinishEdit}
                    onKeyDown={handleKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-transparent outline-none border-b border-current text-sm"
                  />
                ) : (
                  <span className="flex-1 truncate">{tab.name}</span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
                    'hover:bg-destructive/20 hover:text-destructive',
                    !isActive && 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
              </div>
            );
          })}
        </div>

        {/* New Tab Button */}
        <div className="flex items-center border-l border-border px-1">
          <button
            type="button"
            onClick={handleNewTab}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="新建终端"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Terminal Content - use stable terminalIds to prevent DOM reordering */}
      <div className="relative flex-1">
        {terminalIds.map((id) => {
          const isActive = activeId === id;
          return (
            <div key={id} className={isActive ? 'h-full w-full' : 'invisible absolute inset-0'}>
              <ShellTerminal cwd={cwd} isActive={isActive} onExit={() => handleCloseTab(id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
