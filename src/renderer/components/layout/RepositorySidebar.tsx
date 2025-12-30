import { FolderGit2, FolderMinus, PanelLeftClose, Plus, Search, Settings } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

interface Repository {
  name: string;
  path: string;
}

interface RepositorySidebarProps {
  repositories: Repository[];
  selectedRepo: string | null;
  onSelectRepo: (repoPath: string) => void;
  onAddRepository: () => void;
  onRemoveRepository?: (repoPath: string) => void;
  onReorderRepositories?: (fromIndex: number, toIndex: number) => void;
  onOpenSettings?: () => void;
  collapsed?: boolean;
  onCollapse?: () => void;
}

export function RepositorySidebar({
  repositories,
  selectedRepo,
  onSelectRepo,
  onAddRepository,
  onRemoveRepository,
  onReorderRepositories,
  onOpenSettings,
  collapsed: _collapsed = false,
  onCollapse,
}: RepositorySidebarProps) {
  const { t, tNode } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [menuRepo, setMenuRepo] = useState<Repository | null>(null);
  const [repoToRemove, setRepoToRemove] = useState<Repository | null>(null);

  // Drag reorder
  const draggedIndexRef = useRef<number | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number, repo: Repository) => {
    draggedIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));

    // Create styled drag image
    const dragImage = document.createElement('div');
    dragImage.textContent = repo.name;
    dragImage.style.cssText = `
        position: fixed;
        top: -9999px;
        left: -9999px;
        padding: 8px 12px;
        background-color: var(--accent);
        color: var(--accent-foreground);
        font-size: 14px;
        font-weight: 500;
        border-radius: 8px;
        white-space: nowrap;
        pointer-events: none;
      `;
    document.body.appendChild(dragImage);
    dragImageRef.current = dragImage;
    e.dataTransfer.setDragImage(dragImage, dragImage.offsetWidth / 2, dragImage.offsetHeight / 2);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragImageRef.current) {
      document.body.removeChild(dragImageRef.current);
      dragImageRef.current = null;
    }
    draggedIndexRef.current = null;
    setDropTargetIndex(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndexRef.current !== null && draggedIndexRef.current !== index) {
      setDropTargetIndex(index);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = draggedIndexRef.current;
      if (fromIndex !== null && fromIndex !== toIndex && onReorderRepositories) {
        onReorderRepositories(fromIndex, toIndex);
      }
      setDropTargetIndex(null);
    },
    [onReorderRepositories]
  );

  const handleContextMenu = (e: React.MouseEvent, repo: Repository) => {
    e.preventDefault();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setMenuRepo(repo);
    setMenuOpen(true);
  };

  const handleRemoveClick = () => {
    if (menuRepo) {
      setRepoToRemove(menuRepo);
    }
    setMenuOpen(false);
  };

  const handleConfirmRemove = () => {
    if (repoToRemove && onRemoveRepository) {
      onRemoveRepository(repoToRemove.path);
    }
    setRepoToRemove(null);
  };

  // Keep track of original indices for drag reorder
  const filteredRepos = repositories
    .map((repo, index) => ({ repo, originalIndex: index }))
    .filter(({ repo }) => repo.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <aside className="flex h-full w-full flex-col border-r bg-background">
      {/* Header */}
      <div className="flex h-12 items-center justify-end gap-1 border-b px-3 drag-region">
        {onCollapse && (
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md no-drag text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
            onClick={onCollapse}
            title={t('Collapse')}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="flex h-8 items-center gap-2 rounded-lg border bg-background px-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('Search repositories')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
        </div>
      </div>

      {/* Repository List */}
      <div className="flex-1 overflow-auto p-2">
        {filteredRepos.length === 0 && searchQuery.length > 0 ? (
          <Empty className="border-0">
            <EmptyMedia variant="icon">
              <Search className="h-4.5 w-4.5" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle className="text-base">{t('No matching repositories')}</EmptyTitle>
              <EmptyDescription>{t('Try a different search term')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : repositories.length === 0 ? (
          <Empty className="border-0">
            <EmptyMedia variant="icon">
              <FolderGit2 className="h-4.5 w-4.5" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle className="text-base">{t('Add Repository')}</EmptyTitle>
              <EmptyDescription>
                {t('Add a Git repository from a local folder to get started')}
              </EmptyDescription>
            </EmptyHeader>
            <Button onClick={onAddRepository} variant="outline" className="mt-2">
              <Plus className="mr-2 h-4 w-4" />
              {t('Add Repository')}
            </Button>
          </Empty>
        ) : (
          <div className="space-y-1">
            {filteredRepos.map(({ repo, originalIndex }) => (
              <div key={repo.path} className="relative">
                {/* Drop indicator - top */}
                {dropTargetIndex === originalIndex &&
                  draggedIndexRef.current !== null &&
                  draggedIndexRef.current > originalIndex && (
                    <div className="absolute -top-0.5 left-2 right-2 h-0.5 bg-primary rounded-full" />
                  )}
                <button
                  type="button"
                  draggable={!searchQuery}
                  onDragStart={(e) => handleDragStart(e, originalIndex, repo)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, originalIndex)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, originalIndex)}
                  onClick={() => onSelectRepo(repo.path)}
                  onContextMenu={(e) => handleContextMenu(e, repo)}
                  className={cn(
                    'flex w-full flex-col items-start gap-1 rounded-lg p-3 text-left transition-colors',
                    selectedRepo === repo.path
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                    draggedIndexRef.current === originalIndex && 'opacity-50'
                  )}
                >
                  {/* Repo name */}
                  <div className="flex w-full items-center gap-2">
                    <FolderGit2
                      className={cn(
                        'h-4 w-4 shrink-0',
                        selectedRepo === repo.path
                          ? 'text-accent-foreground'
                          : 'text-muted-foreground'
                      )}
                    />
                    <span className="truncate font-medium">{repo.name}</span>
                  </div>
                  {/* Path */}
                  <div
                    className={cn(
                      'w-full truncate pl-6 text-xs',
                      selectedRepo === repo.path
                        ? 'text-accent-foreground/70'
                        : 'text-muted-foreground'
                    )}
                  >
                    {repo.path}
                  </div>
                </button>
                {/* Drop indicator - bottom */}
                {dropTargetIndex === originalIndex &&
                  draggedIndexRef.current !== null &&
                  draggedIndexRef.current < originalIndex && (
                    <div className="absolute -bottom-0.5 left-2 right-2 h-0.5 bg-primary rounded-full" />
                  )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t p-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-8 flex-1 items-center justify-start gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
            onClick={onAddRepository}
          >
            <Plus className="h-4 w-4" />
            {t('Add Repository')}
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
            onClick={onOpenSettings}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Context Menu */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setMenuOpen(false)}
            onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuOpen(false);
            }}
            role="presentation"
          />
          <div
            className="fixed z-50 min-w-32 rounded-lg border bg-popover p-1 shadow-lg"
            style={{ left: menuPosition.x, top: menuPosition.y }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
              onClick={handleRemoveClick}
            >
              <FolderMinus className="h-4 w-4" />
              {t('Remove repository')}
            </button>
          </div>
        </>
      )}

      {/* Remove confirmation dialog */}
      <AlertDialog
        open={!!repoToRemove}
        onOpenChange={(open) => {
          if (!open) {
            setRepoToRemove(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Remove repository')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tNode('Are you sure you want to remove {{name}} from the workspace?', {
                name: <strong>{repoToRemove?.name}</strong>,
              })}
              <span className="block mt-2 text-muted-foreground">
                {t('This will only remove it from the app and will not delete local files.')}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline">{t('Cancel')}</Button>} />
            <Button variant="destructive" onClick={handleConfirmRemove}>
              {t('Remove')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </aside>
  );
}
