import { useCallback, useEffect, useRef, useState } from 'react';
import { type ReviewStatus, type StreamEvent, StreamJsonParser } from '@/lib/stream-json-parser';
import { useSettingsStore } from '@/stores/settings';

const CODE_REVIEW_PROMPT = `Always reply in Chinese.
You are performing a code review on the changes in the current branch.


## Code Review Instructions

The entire git diff for this branch has been provided below, as well as a list of all commits made to this branch.

**CRITICAL: EVERYTHING YOU NEED IS ALREADY PROVIDED BELOW.** The complete git diff and full commit history are included in this message.

**DO NOT run git diff, git log, git status, or ANY other git commands.** All the information you need to perform this review is already here.

When reviewing the diff:
1. **Focus on logic and correctness** - Check for bugs, edge cases, and potential issues.
2. **Consider readability** - Is the code clear and maintainable? Does it follow best practices in this repository?
3. **Evaluate performance** - Are there obvious performance concerns or optimizations that could be made?
4. **Assess test coverage** - Does the repository have testing patterns? If so, are there adequate tests for these changes?
5. **Ask clarifying questions** - Ask the user for clarification if you are unsure about the changes or need more context.
6. **Don't be overly pedantic** - Nitpicks are fine, but only if they are relevant issues within reason.

In your output:
- Provide a summary overview of the general code quality.
- Present the identified issues in a table with the columns: index (1, 2, etc.), line number(s), code, issue, and potential solution(s).
- If no issues are found, briefly state that the code meets best practices.

## Full Diff

**REMINDER: DO NOT use any tools to fetch git information.** Simply read the diff and commit history that follow.

$(git diff HEAD)

## Commit History

$(git log origin/main..HEAD)`;

interface UseCodeReviewOptions {
  repoPath: string | undefined;
}

interface UseCodeReviewReturn {
  content: string;
  status: ReviewStatus;
  error: string | null;
  cost: number | null;
  model: string | null;
  startReview: () => Promise<void>;
  stopReview: () => void;
  reset: () => void;
}

export function useCodeReview({ repoPath }: UseCodeReviewOptions): UseCodeReviewReturn {
  const codeReviewSettings = useSettingsStore((s) => s.codeReview);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<ReviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const parserRef = useRef<StreamJsonParser>(new StreamJsonParser());
  const ptyIdRef = useRef<string | null>(null);
  const cleanupFnsRef = useRef<Array<() => void>>([]);

  // 清理函数
  const cleanup = useCallback(() => {
    for (const fn of cleanupFnsRef.current) {
      fn();
    }
    cleanupFnsRef.current = [];

    if (ptyIdRef.current) {
      window.electronAPI.terminal.destroy(ptyIdRef.current).catch(console.error);
      ptyIdRef.current = null;
    }
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // 处理单个事件
  const handleEvent = useCallback((event: StreamEvent) => {
    // 检查初始化事件
    if (StreamJsonParser.isInitEvent(event)) {
      setStatus('streaming');
      return;
    }

    // 提取文本增量
    const text = StreamJsonParser.extractTextDelta(event);
    if (text) {
      setContent((prev) => `${prev}${text}`);
    }

    // 消息结束时添加换行
    if (StreamJsonParser.isMessageEndEvent(event)) {
      setContent((prev) => `${prev}\n\n`);
    }

    // 检查完成事件并提取费用和模型
    if (StreamJsonParser.isResultEvent(event)) {
      const totalCost = StreamJsonParser.extractCost(event);
      if (totalCost !== null) {
        setCost(totalCost);
      }
      const modelName = StreamJsonParser.extractModel(event);
      if (modelName !== null) {
        setModel(modelName);
      }
      setStatus('complete');
    }

    // 检查错误事件
    if (StreamJsonParser.isErrorEvent(event)) {
      setStatus('error');
      setError(event.message?.toString() || 'Unknown error');
    }
  }, []);

  // 开始代码审查
  const startReview = useCallback(async () => {
    if (!repoPath) {
      setError('No repository path');
      setStatus('error');
      return;
    }

    // 重置状态
    setContent('');
    setError(null);
    setCost(null);
    setModel(null);
    setStatus('initializing');
    parserRef.current.reset();
    cleanup();

    try {
      // 构建命令
      // 使用 shell -c 来执行完整命令，确保 $() 会被展开
      const isWindows = window.electronAPI?.env?.platform === 'win32';

      // 转义 prompt 中的引号
      const escapedPrompt = CODE_REVIEW_PROMPT.replace(/"/g, '\\"');

      const claudeCommand = `claude "${escapedPrompt}" -p --output-format stream-json --no-session-persistence --disallowedTools "Bash(git:*) Edit" --model ${codeReviewSettings.model} --verbose --include-partial-messages`;

      const ptyId = await window.electronAPI.terminal.create({
        cwd: repoPath,
        shell: isWindows ? 'cmd.exe' : '/bin/sh',
        args: isWindows ? ['/c', claudeCommand] : ['-c', claudeCommand],
      });

      ptyIdRef.current = ptyId;

      // 监听数据输出
      const onDataCleanup = window.electronAPI.terminal.onData(({ id, data }) => {
        if (id !== ptyId) return;

        const events = parserRef.current.parse(data);
        for (const event of events) {
          handleEvent(event);
        }
      });
      cleanupFnsRef.current.push(onDataCleanup);

      // 监听退出事件
      const onExitCleanup = window.electronAPI.terminal.onExit(({ id, exitCode }) => {
        if (id !== ptyId) return;

        if (exitCode !== 0 && status !== 'complete') {
          setStatus('error');
          setError(`Process exited with code ${exitCode}`);
        } else if (status !== 'error') {
          setStatus('complete');
        }

        ptyIdRef.current = null;
      });
      cleanupFnsRef.current.push(onExitCleanup);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to start review');
    }
  }, [repoPath, cleanup, handleEvent, status, codeReviewSettings.model]);

  // 停止审查
  const stopReview = useCallback(() => {
    cleanup();
    setStatus('idle');
  }, [cleanup]);

  // 重置状态
  const reset = useCallback(() => {
    cleanup();
    setContent('');
    setError(null);
    setCost(null);
    setModel(null);
    setStatus('idle');
    parserRef.current.reset();
  }, [cleanup]);

  return {
    content,
    status,
    error,
    cost,
    model,
    startReview,
    stopReview,
    reset,
  };
}
