import { exec, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppCategory, type DetectedApp } from '@shared/types';
import { LINUX_APPS, MAC_APPS, WINDOWS_APPS } from './constants';

const execAsync = promisify(exec);
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

export class AppDetector {
  private detectedApps: DetectedApp[] = [];
  private initialized = false;

  async detectApps(): Promise<DetectedApp[]> {
    if (this.initialized) {
      return this.detectedApps;
    }

    if (isWindows) {
      return this.detectWindowsApps();
    }

    if (isMac) {
      return this.detectMacApps();
    }

    if (isLinux) {
      return this.detectLinuxApps();
    }

    // Unknown platform
    this.initialized = true;
    return [];
  }

  private async detectWindowsApps(): Promise<DetectedApp[]> {
    const detected: DetectedApp[] = [];

    for (const app of WINDOWS_APPS) {
      for (const exePath of app.exePaths) {
        // Check if it's an absolute path or a command name
        const isAbsolutePath = exePath.includes('\\') || exePath.includes('/');

        if (isAbsolutePath) {
          if (existsSync(exePath)) {
            detected.push({
              name: app.name,
              bundleId: app.id,
              category: app.category,
              path: exePath,
            });
            break;
          }
        } else {
          // Use 'where' command to find executable in PATH
          try {
            const { stdout } = await execAsync(`where ${exePath}`, { timeout: 3000 });
            const resolvedPath = stdout.trim().split('\n')[0];
            if (resolvedPath) {
              detected.push({
                name: app.name,
                bundleId: app.id,
                category: app.category,
                path: resolvedPath,
              });
              break;
            }
          } catch {
            // Command not found, continue to next path
          }
        }
      }
    }

    this.detectedApps = detected;
    this.initialized = true;
    return detected;
  }

  private async detectMacApps(): Promise<DetectedApp[]> {
    const detected: DetectedApp[] = [];
    const bundleIdToApp = new Map(MAC_APPS.map((app) => [app.bundleId, app]));

    // Scan common app locations
    const appDirs = [
      '/Applications',
      '/System/Applications',
      '/System/Library/CoreServices', // Finder.app
      join(homedir(), 'Applications'),
    ];

    for (const appDir of appDirs) {
      if (!existsSync(appDir)) continue;

      try {
        const entries = await readdir(appDir);
        for (const entry of entries) {
          if (!entry.endsWith('.app')) continue;

          const appPath = join(appDir, entry);
          const plistPath = join(appPath, 'Contents', 'Info.plist');

          if (!existsSync(plistPath)) continue;

          try {
            // Read bundle ID from Info.plist using PlistBuddy
            const { stdout } = await execAsync(
              `/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "${plistPath}" 2>/dev/null`
            );
            const bundleId = stdout.trim();

            const knownApp = bundleIdToApp.get(bundleId);
            if (knownApp) {
              detected.push({
                name: knownApp.name,
                bundleId: knownApp.bundleId,
                category: knownApp.category,
                path: appPath,
              });
            }
          } catch {
            // Failed to read plist, skip
          }
        }
      } catch {
        // Failed to read directory, skip
      }
    }

    this.detectedApps = detected;
    this.initialized = true;
    return detected;
  }

  private async detectLinuxApps(): Promise<DetectedApp[]> {
    const detected: DetectedApp[] = [];

    for (const app of LINUX_APPS) {
      for (const command of app.commands) {
        try {
          const { stdout } = await execAsync(`which ${command}`, { timeout: 3000 });
          const resolvedPath = stdout.trim();
          if (resolvedPath) {
            detected.push({
              name: app.name,
              bundleId: app.id,
              category: app.category,
              path: resolvedPath,
            });
            break; // Found this app, move to next
          }
        } catch {
          // Command not found, try next
        }
      }
    }

    this.detectedApps = detected;
    this.initialized = true;
    return detected;
  }

  async openPath(
    path: string,
    bundleId: string,
    options?: {
      line?: number;
      workspacePath?: string;
      openFiles?: string[];
      activeFile?: string;
    }
  ): Promise<void> {
    const detectedApp = this.detectedApps.find((a) => a.bundleId === bundleId);
    if (!detectedApp) {
      throw new Error(`App with bundle ID ${bundleId} not found`);
    }

    if (isWindows) {
      const escapedExe = detectedApp.path.replace(/'/g, "''");
      const escapedPath = path.replace(/'/g, "''");

      if (bundleId === 'windows.terminal') {
        await execAsync(
          `powershell -Command "Start-Process -FilePath '${escapedExe}' -ArgumentList '-d','${escapedPath}'"`
        );
      } else if (detectedApp.category === AppCategory.Terminal) {
        await execAsync(
          `powershell -Command "Start-Process -FilePath '${escapedExe}' -WorkingDirectory '${escapedPath}'"`
        );
      } else {
        const pathArg = options?.line ? `${escapedPath}:${options.line}` : escapedPath;
        await execAsync(
          `powershell -Command "Start-Process -FilePath '${escapedExe}' -ArgumentList '${pathArg}'"`
        );
      }
    } else if (isLinux) {
      // Linux: execute command directly with path as argument
      const escapedPath = path.replace(/"/g, '\\"');

      if (detectedApp.category === AppCategory.Terminal) {
        // Terminal apps: open in the specified directory
        // Different terminals have different ways to set working directory
        const command = detectedApp.path;
        if (command.includes('gnome-terminal')) {
          await execAsync(`"${command}" --working-directory="${escapedPath}"`);
        } else if (command.includes('konsole')) {
          await execAsync(`"${command}" --workdir "${escapedPath}"`);
        } else if (command.includes('alacritty')) {
          await execAsync(`"${command}" --working-directory "${escapedPath}"`);
        } else if (command.includes('kitty')) {
          await execAsync(`"${command}" --directory "${escapedPath}"`);
        } else if (command.includes('tilix')) {
          await execAsync(`"${command}" --working-directory="${escapedPath}"`);
        } else if (command.includes('terminator')) {
          await execAsync(`"${command}" --working-directory="${escapedPath}"`);
        } else {
          // Generic fallback: try to cd and open
          await execAsync(`cd "${escapedPath}" && "${command}"`);
        }
      } else if (detectedApp.category === AppCategory.Finder) {
        // File managers: open directory
        await execAsync(`"${detectedApp.path}" "${escapedPath}"`);
      } else {
        // Editors and other apps: pass path as argument
        await execAsync(`"${detectedApp.path}" "${escapedPath}"`);
      }
    } else {
      // macOS: use open command or direct CLI
      if (detectedApp.category === AppCategory.Editor && options?.workspacePath) {
        // For editors, use CLI to open workspace with files
        await this.openEditorWithFiles(bundleId, detectedApp.path, {
          ...options,
          workspacePath: options.workspacePath,
        });
      } else if (options?.line && detectedApp.category === AppCategory.Editor) {
        const lineArgs = this.getLineArgs(bundleId, path, options.line);
        await execAsync(`open -b "${bundleId}" ${lineArgs}`);
      } else {
        await execAsync(`open -b "${bundleId}" "${path}"`);
      }
    }
  }

  private async openEditorWithFiles(
    bundleId: string,
    appPath: string,
    options: {
      workspacePath: string;
      openFiles?: string[];
      activeFile?: string;
      line?: number;
    }
  ): Promise<void> {
    // Get CLI executable path based on editor type
    const cliPath = this.getEditorCliPath(bundleId, appPath);

    if (!cliPath) {
      // Fallback to simple open
      await execAsync(`open -b "${bundleId}" "${options.workspacePath}"`);
      return;
    }

    // Strategy: Open workspace and all files first, then use -g to navigate to specific line
    // This ensures the workspace is loaded before attempting to jump to the line
    const allFiles = options.openFiles || [];

    // Step 1: Open workspace with all files (including activeFile)
    let cmd1 = `"${cliPath}" "${options.workspacePath}"`;
    for (const file of allFiles) {
      cmd1 += ` "${file}"`;
    }

    try {
      await execAsync(cmd1);

      // Step 2: If we have an active file with a line number, use -g to navigate
      if (options.activeFile && options.line) {
        // Wait a bit for editor to load the workspace
        await new Promise((resolve) => setTimeout(resolve, 500));

        const cmd2 = `"${cliPath}" -g "${options.activeFile}:${options.line}"`;
        await execAsync(cmd2);
      }
    } catch {
      // CLI failed, fallback to open command
      await execAsync(`open -b "${bundleId}" "${options.workspacePath}"`);
    }
  }

  private getEditorCliPath(bundleId: string, appPath: string): string | null {
    // VSCode, Cursor, Codium
    if (
      bundleId.includes('com.microsoft.VSCode') ||
      bundleId.includes('com.todesktop.230313mzl4w4u92') || // Cursor
      bundleId.includes('com.visualstudio.code')
    ) {
      // Try to find CLI in common locations
      const possiblePaths = [
        '/usr/local/bin/cursor',
        '/opt/homebrew/bin/cursor',
        '/usr/local/bin/code',
        '/opt/homebrew/bin/code',
        `${appPath}/Contents/Resources/app/bin/cursor`,
        `${appPath}/Contents/Resources/app/bin/code`,
      ];

      for (const path of possiblePaths) {
        try {
          execSync(`test -f "${path}"`);
          return path;
        } catch {}
      }
    }

    // Zed
    if (bundleId.includes('dev.zed.Zed')) {
      const possiblePaths = ['/usr/local/bin/zed', '/opt/homebrew/bin/zed'];
      for (const path of possiblePaths) {
        try {
          execSync(`test -f "${path}"`);
          return path;
        } catch {}
      }
    }

    return null;
  }

  private getLineArgs(bundleId: string, path: string, line: number): string {
    // VSCode, Cursor, Codium (all use VSCode format)
    if (
      bundleId.includes('com.microsoft.VSCode') ||
      bundleId.includes('com.todesktop.230313mzl4w4u92') || // Cursor
      bundleId.includes('com.visualstudio.code')
    ) {
      return `--args "${path}" -g "${path}:${line}"`;
    }

    // Zed
    if (bundleId.includes('dev.zed.Zed')) {
      return `"${path}:${line}"`;
    }

    // Sublime Text
    if (bundleId.includes('com.sublimetext')) {
      return `"${path}:${line}"`;
    }

    // IntelliJ IDEA, WebStorm, PyCharm, etc.
    if (bundleId.includes('com.jetbrains')) {
      return `--args --line ${line} "${path}"`;
    }

    // Atom
    if (bundleId.includes('com.github.atom')) {
      return `"${path}:${line}"`;
    }

    // Default: try file:line format (works for many editors)
    return `"${path}:${line}"`;
  }

  async getAppIcon(bundleId: string): Promise<string | undefined> {
    const detectedApp = this.detectedApps.find((a) => a.bundleId === bundleId);
    if (!detectedApp) return undefined;

    if (isWindows) {
      // Windows icon extraction is complex, return undefined for now
      // Could use powershell or native module in future
      return undefined;
    }

    if (!isMac) {
      return undefined;
    }

    try {
      // Get icon file name from Info.plist
      const { stdout } = await execAsync(
        `/usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" "${detectedApp.path}/Contents/Info.plist" 2>/dev/null || ` +
          `/usr/libexec/PlistBuddy -c "Print :CFBundleIconName" "${detectedApp.path}/Contents/Info.plist" 2>/dev/null`
      );

      let iconName = stdout.trim();
      if (!iconName) return undefined;
      if (!iconName.endsWith('.icns')) {
        iconName += '.icns';
      }

      const icnsPath = join(detectedApp.path, 'Contents', 'Resources', iconName);
      if (!existsSync(icnsPath)) return undefined;

      // Convert icns to png using sips (required for ic13 format on macOS 26+)
      const tmpPng = join(tmpdir(), `enso-icon-${bundleId.replace(/\./g, '-')}.png`);
      await execAsync(`sips -s format png -z 128 128 "${icnsPath}" --out "${tmpPng}" 2>/dev/null`);

      const pngData = await readFile(tmpPng);
      return `data:image/png;base64,${pngData.toString('base64')}`;
    } catch {
      return undefined;
    }
  }
}

export const appDetector = new AppDetector();
