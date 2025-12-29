import type { GitBranch as GitBranchType, WorktreeCreateOptions } from '@shared/types';
import { GitBranch, Plus } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSeparator,
} from '@/components/ui/combobox';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';

// Get display name for branch (remove remotes/ prefix for remote branches)
const getBranchDisplayName = (name: string) => {
  return name.startsWith('remotes/') ? name.replace('remotes/', '') : name;
};

interface CreateWorktreeDialogProps {
  branches: GitBranchType[];
  projectName: string;
  isLoading?: boolean;
  onSubmit: (options: WorktreeCreateOptions) => Promise<void>;
  trigger?: React.ReactElement;
}

export function CreateWorktreeDialog({
  branches,
  projectName,
  isLoading,
  onSubmit,
  trigger,
}: CreateWorktreeDialogProps) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [baseBranch, setBaseBranch] = React.useState<string>('');
  const [newBranchName, setNewBranchName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // Fixed path: ~/ensoai/workspaces/{projectName}/{branchName}
  const home = window.electronAPI?.env?.HOME || '';
  const isWindows = window.electronAPI?.env?.platform === 'win32';
  const pathSep = isWindows ? '\\' : '/';
  const getWorktreePath = (branchName: string) => {
    if (!home) return '';
    // Extract last directory name from projectName when a full path is passed in.
    const normalizedName = projectName.replace(/\\/g, '/');
    const projectBaseName = normalizedName.split('/').filter(Boolean).pop() || projectName;
    return [home, 'ensoai', 'workspaces', projectBaseName, branchName].join(pathSep);
  };

  // Branch item type for combobox
  type BranchItem = { id: string; label: string; value: string };
  type BranchGroup = { value: string; label: string; items: BranchItem[] };

  // Convert branches to grouped combobox items format
  const branchGroups = React.useMemo((): BranchGroup[] => {
    const localItems: BranchItem[] = [];
    const remoteItems: BranchItem[] = [];

    for (const b of branches) {
      const item: BranchItem = {
        id: b.name,
        label: getBranchDisplayName(b.name) + (b.current ? ` (${t('Current')})` : ''),
        value: b.name,
      };
      if (b.name.startsWith('remotes/')) {
        remoteItems.push(item);
      } else {
        localItems.push(item);
      }
    }

    const groups: BranchGroup[] = [];
    if (localItems.length > 0) {
      groups.push({ value: 'local', label: t('Local branches'), items: localItems });
    }
    if (remoteItems.length > 0) {
      groups.push({ value: 'remote', label: t('Remote branches'), items: remoteItems });
    }
    return groups;
  }, [branches, t]);

  // Use current branch as default base
  const currentBranch = branches.find((b) => b.current);
  const defaultBranchItem = React.useMemo(() => {
    if (!currentBranch) return null;
    for (const group of branchGroups) {
      const found = group.items.find((item) => item.value === currentBranch.name);
      if (found) return found;
    }
    return null;
  }, [branchGroups, currentBranch]);

  // Initialize baseBranch state when dialog opens
  React.useEffect(() => {
    if (open && currentBranch && !baseBranch) {
      setBaseBranch(currentBranch.name);
    }
  }, [open, currentBranch, baseBranch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newBranchName) {
      setError(t('Enter new branch name'));
      return;
    }

    if (!baseBranch) {
      setError(t('Select base branch'));
      return;
    }

    if (!home) {
      setError(t('Unable to determine your home directory'));
      return;
    }

    try {
      await onSubmit({
        path: getWorktreePath(newBranchName),
        branch: baseBranch,
        newBranch: newBranchName,
      });
      setOpen(false);
      resetForm();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('Failed to create');
      if (message.includes('already exists')) {
        setError(t('Worktree path already exists. Choose a different path or branch name.'));
      } else if (
        message.includes('is already used by worktree') ||
        message.includes('already checked out')
      ) {
        setError(t('Branch already exists. Choose a different name.'));
      } else {
        setError(message);
      }
    }
  };

  const resetForm = () => {
    setBaseBranch(currentBranch?.name || '');
    setNewBranchName('');
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {t('New')}
            </Button>
          )
        }
      />
      <DialogPopup>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('New Worktree')}</DialogTitle>
            <DialogDescription>
              {t('Create a new branch and work in a separate directory to handle multiple tasks.')}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="space-y-4">
            {/* New Branch Name */}
            <Field>
              <FieldLabel>{t('Branch name')}</FieldLabel>
              <Input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="feature/my-feature"
                autoFocus
              />
              <FieldDescription>
                {t('This branch will be created and checked out in the new worktree.')}
              </FieldDescription>
            </Field>

            {/* Base Branch Selection with Search */}
            <Field>
              <FieldLabel>{t('Base branch')}</FieldLabel>
              <Combobox
                items={branchGroups}
                defaultValue={defaultBranchItem}
                onValueChange={(item: BranchItem | null) => setBaseBranch(item?.value || '')}
              >
                <ComboboxInput
                  placeholder={t('Search branches...')}
                  startAddon={<GitBranch className="h-4 w-4" />}
                  showTrigger
                />
                <ComboboxPopup>
                  <ComboboxEmpty>{t('No branches found')}</ComboboxEmpty>
                  <ComboboxList>
                    {(group: BranchGroup) => (
                      <React.Fragment key={group.value}>
                        <ComboboxGroup items={group.items}>
                          <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
                          <ComboboxCollection>
                            {(item: BranchItem) => (
                              <ComboboxItem key={item.id} value={item}>
                                {item.label}
                              </ComboboxItem>
                            )}
                          </ComboboxCollection>
                        </ComboboxGroup>
                        {group.value === 'local' && branchGroups.length > 1 && (
                          <ComboboxSeparator />
                        )}
                      </React.Fragment>
                    )}
                  </ComboboxList>
                </ComboboxPopup>
              </Combobox>
            </Field>

            {/* Path Preview */}
            {newBranchName && home && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                <span className="font-medium">{t('Save location')}:</span>
                <code className="ml-1 break-all">{getWorktreePath(newBranchName)}</code>
              </div>
            )}

            {error && <div className="text-sm text-destructive">{error}</div>}
          </DialogPanel>

          <DialogFooter variant="bare">
            <DialogClose render={<Button variant="outline">{t('Cancel')}</Button>} />
            <Button type="submit" disabled={isLoading}>
              {isLoading ? t('Creating...') : t('Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
