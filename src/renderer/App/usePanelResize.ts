import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REPOSITORY_DEFAULT,
  REPOSITORY_MAX,
  REPOSITORY_MIN,
  TREE_SIDEBAR_MIN,
  WORKTREE_DEFAULT,
  WORKTREE_MAX,
  WORKTREE_MIN,
} from './constants';
import { getStoredNumber, STORAGE_KEYS } from './storage';

type ResizePanel = 'repository' | 'worktree' | null;
type LayoutMode = 'columns' | 'tree';

export function usePanelResize(layoutMode: LayoutMode = 'columns') {
  const [repositoryWidth, setRepositoryWidth] = useState(() =>
    getStoredNumber(STORAGE_KEYS.REPOSITORY_WIDTH, REPOSITORY_DEFAULT)
  );
  const [worktreeWidth, setWorktreeWidth] = useState(() =>
    getStoredNumber(STORAGE_KEYS.WORKTREE_WIDTH, WORKTREE_DEFAULT)
  );
  const [resizing, setResizing] = useState<ResizePanel>(null);

  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback(
    (panel: 'repository' | 'worktree') => (e: React.MouseEvent) => {
      e.preventDefault();
      setResizing(panel);
      startXRef.current = e.clientX;
      // In tree mode, track combined width for repository panel resize
      if (layoutMode === 'tree' && panel === 'repository') {
        startWidthRef.current = repositoryWidth + worktreeWidth;
      } else {
        startWidthRef.current = panel === 'repository' ? repositoryWidth : worktreeWidth;
      }
    },
    [repositoryWidth, worktreeWidth, layoutMode]
  );

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth = startWidthRef.current + delta;

      if (resizing === 'repository') {
        if (layoutMode === 'tree') {
          // In tree mode, resize the combined sidebar with tree-specific min
          const treeMax = REPOSITORY_MAX + WORKTREE_MAX;
          const clampedTotal = Math.max(TREE_SIDEBAR_MIN, Math.min(treeMax, newWidth));
          // Distribute the change to repositoryWidth only
          setRepositoryWidth(clampedTotal - worktreeWidth);
        } else {
          setRepositoryWidth(Math.max(REPOSITORY_MIN, Math.min(REPOSITORY_MAX, newWidth)));
        }
      } else {
        setWorktreeWidth(Math.max(WORKTREE_MIN, Math.min(WORKTREE_MAX, newWidth)));
      }
    };

    const handleMouseUp = () => {
      setResizing(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, layoutMode, worktreeWidth]);

  // Save panel sizes to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.REPOSITORY_WIDTH, String(repositoryWidth));
  }, [repositoryWidth]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WORKTREE_WIDTH, String(worktreeWidth));
  }, [worktreeWidth]);

  return {
    repositoryWidth,
    worktreeWidth,
    resizing,
    handleResizeStart,
  };
}
