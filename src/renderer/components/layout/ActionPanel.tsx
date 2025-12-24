import {
  ExternalLink,
  FolderOpen,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react';
import * as React from 'react';
import { useEffect, useRef } from 'react';
import {
  CommandDialog,
  CommandDialogPopup,
  CommandPanel,
  CommandShortcut,
} from '@/components/ui/command';
import { useDetectedApps, useOpenWith } from '@/hooks/useAppDetector';
import { cn } from '@/lib/utils';

interface ActionPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceCollapsed: boolean;
  worktreeCollapsed: boolean;
  projectPath?: string;
  onToggleWorkspace: () => void;
  onToggleWorktree: () => void;
  onOpenSettings: () => void;
}

interface ActionItem {
  id: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  action: () => void;
}

interface ActionGroup {
  label: string;
  items: ActionItem[];
}

export function ActionPanel({
  open,
  onOpenChange,
  workspaceCollapsed,
  worktreeCollapsed,
  projectPath,
  onToggleWorkspace,
  onToggleWorktree,
  onOpenSettings,
}: ActionPanelProps) {
  const [search, setSearch] = React.useState('');
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: detectedApps = [] } = useDetectedApps();
  const openWith = useOpenWith();

  const actionGroups: ActionGroup[] = React.useMemo(() => {
    const groups: ActionGroup[] = [
      {
        label: '面板',
        items: [
          {
            id: 'toggle-workspace',
            label: workspaceCollapsed ? '展开 Workspace' : '折叠 Workspace',
            icon: workspaceCollapsed ? FolderOpen : PanelLeftClose,
            action: onToggleWorkspace,
          },
          {
            id: 'toggle-worktree',
            label: worktreeCollapsed ? '展开 Worktree' : '折叠 Worktree',
            icon: worktreeCollapsed ? GitBranch : PanelLeftOpen,
            action: onToggleWorktree,
          },
        ],
      },
      {
        label: '通用',
        items: [
          {
            id: 'open-settings',
            label: '打开设置',
            icon: Settings,
            shortcut: '⌘,',
            action: onOpenSettings,
          },
        ],
      },
    ];

    // Add "Open in XXX" group for detected apps
    if (projectPath && detectedApps.length > 0) {
      groups.push({
        label: '打开方式',
        items: detectedApps.map((app) => ({
          id: `open-in-${app.bundleId}`,
          label: `在 ${app.name} 打开`,
          icon: ExternalLink,
          action: () => {
            openWith.mutate({ path: projectPath, bundleId: app.bundleId });
          },
        })),
      });
    }

    return groups;
  }, [
    workspaceCollapsed,
    worktreeCollapsed,
    projectPath,
    detectedApps,
    onToggleWorkspace,
    onToggleWorktree,
    onOpenSettings,
    openWith,
  ]);

  // Flatten and filter actions for keyboard navigation
  const filteredGroups = React.useMemo(() => {
    if (!search) return actionGroups;
    const lower = search.toLowerCase();
    return actionGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.toLowerCase().includes(lower)),
      }))
      .filter((group) => group.items.length > 0);
  }, [actionGroups, search]);

  const flatFilteredItems = React.useMemo(
    () => filteredGroups.flatMap((g) => g.items),
    [filteredGroups]
  );

  // Reset selection when filtered list changes
  const filteredCount = flatFilteredItems.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset index on count change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCount]);

  // Scroll selected item into view
  useEffect(() => {
    const selected = document.querySelector(`[data-action-index="${selectedIndex}"]`);
    selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  // Reset search and focus input when dialog opens/closes
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setSearch('');
      setSelectedIndex(0);
    }
  }, [open]);

  const executeAction = React.useCallback(
    (action: ActionItem) => {
      action.action();
      onOpenChange(false);
    },
    [onOpenChange]
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % flatFilteredItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + flatFilteredItems.length) % flatFilteredItems.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const action = flatFilteredItems[selectedIndex];
        if (action) {
          executeAction(action);
        }
      }
    },
    [flatFilteredItems, selectedIndex, executeAction]
  );

  // Calculate global index for each item
  let globalIndex = -1;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup>
        <CommandPanel>
          <div className="px-3 py-2" onKeyDown={handleKeyDown}>
            <input
              ref={inputRef}
              type="text"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="搜索操作..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="border-t" />
          <div className="max-h-72 overflow-y-auto p-2">
            {flatFilteredItems.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                没有找到匹配的操作
              </div>
            ) : (
              filteredGroups.map((group, groupIdx) => (
                <div key={group.label} className={groupIdx > 0 ? 'mt-2' : ''}>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    globalIndex++;
                    const currentIndex = globalIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-action-index={currentIndex}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
                          currentIndex === selectedIndex
                            ? 'bg-accent text-accent-foreground'
                            : 'text-foreground hover:bg-accent/50'
                        )}
                        onClick={() => executeAction(item)}
                        onMouseEnter={() => setSelectedIndex(currentIndex)}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </CommandPanel>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
