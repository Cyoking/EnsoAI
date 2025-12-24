import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEditorStore } from '@/stores/editor';

export function useEditor() {
  const {
    tabs,
    activeTabPath,
    openFile,
    closeFile,
    setActiveFile,
    updateFileContent,
    markFileSaved,
    setTabViewState,
    reorderTabs,
  } = useEditorStore();

  const queryClient = useQueryClient();

  const loadFile = useMutation({
    mutationFn: async (path: string) => {
      const content = await window.electronAPI.file.read(path);
      openFile({ path, content, isDirty: false });
      return content;
    },
  });

  const saveFile = useMutation({
    mutationFn: async (path: string) => {
      const file = tabs.find((f) => f.path === path);
      if (!file) throw new Error('File not found');
      await window.electronAPI.file.write(path, file.content);
      markFileSaved(path);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file', 'list'] });
    },
  });

  const activeTab = tabs.find((f) => f.path === activeTabPath) || null;

  return {
    tabs,
    activeTab,
    loadFile,
    saveFile,
    closeFile,
    setActiveFile,
    updateFileContent,
    setTabViewState,
    reorderTabs,
  };
}
