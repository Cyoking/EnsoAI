import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface NewItemDialogProps {
  isOpen: boolean;
  type: 'file' | 'directory';
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function NewItemDialog({ isOpen, type, onConfirm, onCancel }: NewItemDialogProps) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName('');
    }
  }, [isOpen]);

  const title = type === 'file' ? 'New File' : 'New Folder';
  const placeholder = type === 'file' ? 'filename.ts' : 'folder-name';

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && name.trim()) {
        onConfirm(name.trim());
      }
    },
    [name, onConfirm]
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Enter a name for the new {type === 'file' ? 'file' : 'folder'}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoFocus
          />
        </DialogPanel>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={() => name.trim() && onConfirm(name.trim())} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
