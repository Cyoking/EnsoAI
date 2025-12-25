import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from './ui/dialog';

interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: {
    version?: string;
    releaseNotes?: string;
  };
  progress?: {
    percent: number;
    bytesPerSecond: number;
    total: number;
    transferred: number;
  };
  error?: string;
  downloadUrl?: string; // For macOS manual update
}

export function UpdateNotification() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const cleanup = window.electronAPI.updater.onStatus((newStatus) => {
      setStatus(newStatus as UpdateStatus);

      // Auto-open dialog when:
      // - Update downloaded (Windows)
      // - Update available with downloadUrl (macOS)
      if (
        newStatus.status === 'downloaded' ||
        (newStatus.status === 'available' && (newStatus as UpdateStatus).downloadUrl)
      ) {
        setDialogOpen(true);
      }
    });

    return cleanup;
  }, []);

  const handleInstall = useCallback(() => {
    window.electronAPI.updater.quitAndInstall();
  }, []);

  const handleOpenDownload = useCallback(() => {
    if (status?.downloadUrl) {
      window.electronAPI.shell.openExternal(status.downloadUrl);
      setDialogOpen(false);
    }
  }, [status?.downloadUrl]);

  const handleLater = useCallback(() => {
    setDialogOpen(false);
  }, []);

  // Format bytes to human readable
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Show downloading indicator in corner (Windows only)
  if (status?.status === 'downloading' && status.progress) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
        <Download className="h-4 w-4 animate-pulse text-primary" />
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">正在下载更新</span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${status.progress.percent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {formatBytes(status.progress.bytesPerSecond)}/s
            </span>
          </div>
        </div>
      </div>
    );
  }

  // macOS: manual download dialog
  const isMacOSManual = status?.status === 'available' && status.downloadUrl;

  // Windows: auto-install dialog
  const isWindowsReady = status?.status === 'downloaded';

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogPopup className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isMacOSManual ? (
              <Download className="h-5 w-5 text-primary" />
            ) : (
              <RefreshCw className="h-5 w-5 text-primary" />
            )}
            {isMacOSManual ? '发现新版本' : '更新已就绪'}
          </DialogTitle>
          <DialogDescription>
            {isMacOSManual ? (
              <>新版本 {status?.info?.version || ''} 已发布，请前往下载页面手动更新。</>
            ) : (
              <>新版本 {status?.info?.version || ''} 已下载完成，是否立即重启安装？</>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={handleLater}>
            稍后
          </Button>
          {isMacOSManual ? (
            <Button onClick={handleOpenDownload}>
              <ExternalLink className="mr-2 h-4 w-4" />
              前往下载
            </Button>
          ) : (
            <Button onClick={handleInstall}>立即重启</Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
