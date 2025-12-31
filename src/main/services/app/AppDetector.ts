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
    const detectedIds = new Set<string>();

    // First, detect apps from registry (more reliable for JetBrains IDEs)
    const registryApps = await this.detectWindowsAppsFromRegistry();
    for (const app of registryApps) {
      detected.push(app);
      detectedIds.add(app.bundleId);
    }

    // Then check predefined paths for apps not found in registry
    for (const app of WINDOWS_APPS) {
      if (detectedIds.has(app.id)) continue;

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
            detectedIds.add(app.id);
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
              detectedIds.add(app.id);
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

  private async detectWindowsAppsFromRegistry(): Promise<DetectedApp[]> {
    const detected: DetectedApp[] = [];

    // JetBrains product name patterns and their bundleIds
    const jetbrainsProducts: Record<string, { id: string; category: AppCategory }> = {
      'IntelliJ IDEA': { id: 'com.jetbrains.intellij', category: AppCategory.Editor },
      WebStorm: { id: 'com.jetbrains.WebStorm', category: AppCategory.Editor },
      PyCharm: { id: 'com.jetbrains.pycharm', category: AppCategory.Editor },
      GoLand: { id: 'com.jetbrains.goland', category: AppCategory.Editor },
      CLion: { id: 'com.jetbrains.CLion', category: AppCategory.Editor },
      RustRover: { id: 'com.jetbrains.rustrover', category: AppCategory.Editor },
      Rider: { id: 'com.jetbrains.rider', category: AppCategory.Editor },
      PhpStorm: { id: 'com.jetbrains.PhpStorm', category: AppCategory.Editor },
      DataGrip: { id: 'com.jetbrains.datagrip', category: AppCategory.Editor },
      'Android Studio': { id: 'com.google.android.studio', category: AppCategory.Editor },
      Fleet: { id: 'com.jetbrains.fleet', category: AppCategory.Editor },
    };

    // Query registry for installed apps
    const registryPaths = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ];

    for (const regPath of registryPaths) {
      try {
        // Get all subkeys
        const { stdout: keysOutput } = await execAsync(`reg query "${regPath}"`, {
          timeout: 5000,
          encoding: 'utf8',
        });

        const subkeys = keysOutput
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith(regPath));

        for (const subkey of subkeys) {
          try {
            const { stdout: valuesOutput } = await execAsync(`reg query "${subkey}"`, {
              timeout: 3000,
              encoding: 'utf8',
            });

            // Parse DisplayName and InstallLocation/DisplayIcon
            const displayNameMatch = valuesOutput.match(/DisplayName\s+REG_SZ\s+(.+)/);
            const installLocationMatch = valuesOutput.match(/InstallLocation\s+REG_SZ\s+(.+)/);
            const displayIconMatch = valuesOutput.match(/DisplayIcon\s+REG_SZ\s+(.+)/);

            if (!displayNameMatch) continue;
            const displayName = displayNameMatch[1].trim();

            // Check if it's a JetBrains product
            for (const [productName, productInfo] of Object.entries(jetbrainsProducts)) {
              if (displayName.includes(productName)) {
                // Get executable path
                let exePath = '';
                if (installLocationMatch) {
                  const installLocation = installLocationMatch[1].trim();
                  // JetBrains IDEs have exe in bin folder
                  const possibleExe = join(
                    installLocation,
                    'bin',
                    `${productName.toLowerCase().replace(/\s+/g, '')}64.exe`
                  );
                  if (existsSync(possibleExe)) {
                    exePath = possibleExe;
                  } else {
                    // Try common exe names
                    const exeNames = [
                      'idea64.exe',
                      'webstorm64.exe',
                      'pycharm64.exe',
                      'goland64.exe',
                      'clion64.exe',
                      'rustrover64.exe',
                      'rider64.exe',
                      'phpstorm64.exe',
                      'datagrip64.exe',
                      'studio64.exe',
                      'fleet.exe',
                    ];
                    for (const exeName of exeNames) {
                      const testPath = join(installLocation, 'bin', exeName);
                      if (existsSync(testPath)) {
                        exePath = testPath;
                        break;
                      }
                    }
                  }
                }

                if (!exePath && displayIconMatch) {
                  // Try to extract exe path from DisplayIcon
                  const iconPath = displayIconMatch[1].trim().split(',')[0].replace(/"/g, '');
                  if (existsSync(iconPath) && iconPath.endsWith('.exe')) {
                    exePath = iconPath;
                  }
                }

                if (exePath) {
                  detected.push({
                    name: productName,
                    bundleId: productInfo.id,
                    category: productInfo.category,
                    path: exePath,
                  });
                }
                break;
              }
            }
          } catch {
            // Skip this subkey
          }
        }
      } catch {
        // Skip this registry path
      }
    }

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
      } else if (bundleId === 'windows.explorer') {
        // Explorer needs path with backslashes
        const windowsPath = path.replace(/\//g, '\\');
        await execAsync(`start "" "${windowsPath}"`);
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
