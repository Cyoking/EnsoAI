import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TerminalSearchBar,
  type TerminalSearchBarRef,
} from '@/components/terminal/TerminalSearchBar';
import { useXterm } from '@/hooks/useXterm';

interface AgentTerminalProps {
  cwd?: string;
  sessionId?: string;
  agentCommand?: string;
  initialized?: boolean;
  isActive?: boolean;
  onInitialized?: () => void;
  onExit?: () => void;
}

const MIN_RUNTIME_FOR_AUTO_CLOSE = 10000; // 10 seconds

export function AgentTerminal({
  cwd,
  sessionId,
  agentCommand = 'claude',
  initialized,
  isActive = false,
  onInitialized,
  onExit,
}: AgentTerminalProps) {
  const outputBufferRef = useRef('');
  const startTimeRef = useRef<number | null>(null);
  const hasInitializedRef = useRef(false);

  // Build command with session args
  const command = useMemo(() => {
    const supportsSession = agentCommand === 'claude';
    const agentArgs =
      supportsSession && sessionId
        ? initialized
          ? ['--resume', sessionId]
          : ['--session-id', sessionId]
        : [];
    const fullCommand = `${agentCommand} ${agentArgs.join(' ')}`.trim();

    return {
      shell: '/bin/zsh',
      args: ['-i', '-l', '-c', fullCommand],
    };
  }, [agentCommand, sessionId, initialized]);

  // Handle exit with auto-close logic
  const handleExit = useCallback(() => {
    const runtime = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
    const isSessionNotFound = outputBufferRef.current.includes(
      'No conversation found with session ID'
    );

    if (runtime >= MIN_RUNTIME_FOR_AUTO_CLOSE || isSessionNotFound) {
      onExit?.();
    }
    // Quick exit without session error - keep tab open for debugging
  }, [onExit]);

  // Track output for error detection
  const handleData = useCallback(
    (data: string) => {
      // Start timer on first data
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }

      // Mark as initialized on first data
      if (!hasInitializedRef.current && !initialized) {
        hasInitializedRef.current = true;
        onInitialized?.();
      }

      // Buffer output for error detection
      outputBufferRef.current += data;
      if (outputBufferRef.current.length > 1000) {
        outputBufferRef.current = outputBufferRef.current.slice(-500);
      }
    },
    [initialized, onInitialized]
  );

  // Handle Shift+Enter for newline
  const handleCustomKey = useCallback((event: KeyboardEvent, ptyId: string) => {
    if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
      window.electronAPI.terminal.write(ptyId, '\x1b\r');
      return false;
    }
    return true;
  }, []);

  const { containerRef, isLoading, settings, findNext, findPrevious, clearSearch } = useXterm({
    cwd,
    command,
    isActive,
    onExit: handleExit,
    onData: handleData,
    onCustomKey: handleCustomKey,
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchBarRef = useRef<TerminalSearchBarRef>(null);

  // Handle Cmd+F / Ctrl+F
  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        if (isSearchOpen) {
          searchBarRef.current?.focus();
        } else {
          setIsSearchOpen(true);
        }
      }
    },
    [isSearchOpen]
  );

  useEffect(() => {
    if (!isActive) return;
    window.addEventListener('keydown', handleSearchKeyDown);
    return () => window.removeEventListener('keydown', handleSearchKeyDown);
  }, [isActive, handleSearchKeyDown]);

  return (
    <div className="relative h-full w-full" style={{ backgroundColor: settings.theme.background }}>
      <div ref={containerRef} className="h-full w-full px-[5px] py-[2px]" />
      <TerminalSearchBar
        ref={searchBarRef}
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onFindNext={findNext}
        onFindPrevious={findPrevious}
        onClearSearch={clearSearch}
        theme={settings.theme}
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
              style={{ color: settings.theme.foreground, opacity: 0.5 }}
            />
            <span style={{ color: settings.theme.foreground, opacity: 0.5 }} className="text-sm">
              Loading {agentCommand}...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
