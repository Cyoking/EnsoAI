import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppCategory, type DetectedApp } from '@shared/types';

const execAsync = promisify(exec);

interface KnownApp {
  name: string;
  bundleId: string;
  category: AppCategory;
}

export class AppDetector {
  private static knownApps: KnownApp[] = [
    // Terminals
    { name: 'Terminal', bundleId: 'com.apple.Terminal', category: AppCategory.Terminal },
    { name: 'iTerm', bundleId: 'com.googlecode.iterm2', category: AppCategory.Terminal },
    { name: 'Warp', bundleId: 'dev.warp.Warp-Stable', category: AppCategory.Terminal },
    { name: 'Alacritty', bundleId: 'org.alacritty', category: AppCategory.Terminal },
    { name: 'Kitty', bundleId: 'net.kovidgoyal.kitty', category: AppCategory.Terminal },
    { name: 'Hyper', bundleId: 'co.zeit.hyper', category: AppCategory.Terminal },
    { name: 'Ghostty', bundleId: 'com.mitchellh.ghostty', category: AppCategory.Terminal },
    { name: 'Rio', bundleId: 'com.raphamorim.rio', category: AppCategory.Terminal },

    // Editors - Mainstream
    { name: 'Xcode', bundleId: 'com.apple.dt.Xcode', category: AppCategory.Editor },
    { name: 'Visual Studio Code', bundleId: 'com.microsoft.VSCode', category: AppCategory.Editor },
    { name: 'VSCodium', bundleId: 'com.visualstudio.code.oss', category: AppCategory.Editor },
    { name: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92', category: AppCategory.Editor },
    { name: 'Windsurf', bundleId: 'com.exafunction.windsurf', category: AppCategory.Editor },
    { name: 'Sublime Text', bundleId: 'com.sublimetext.4', category: AppCategory.Editor },
    { name: 'Nova', bundleId: 'com.panic.Nova', category: AppCategory.Editor },
    { name: 'TextMate', bundleId: 'com.macromates.TextMate', category: AppCategory.Editor },
    { name: 'Zed', bundleId: 'dev.zed.Zed', category: AppCategory.Editor },

    // Editors - JetBrains
    { name: 'Android Studio', bundleId: 'com.google.android.studio', category: AppCategory.Editor },
    { name: 'IntelliJ IDEA', bundleId: 'com.jetbrains.intellij', category: AppCategory.Editor },
    {
      name: 'IntelliJ IDEA CE',
      bundleId: 'com.jetbrains.intellij.ce',
      category: AppCategory.Editor,
    },
    { name: 'WebStorm', bundleId: 'com.jetbrains.WebStorm', category: AppCategory.Editor },
    { name: 'PyCharm', bundleId: 'com.jetbrains.pycharm', category: AppCategory.Editor },
    { name: 'PyCharm CE', bundleId: 'com.jetbrains.pycharm.ce', category: AppCategory.Editor },
    { name: 'CLion', bundleId: 'com.jetbrains.CLion', category: AppCategory.Editor },
    { name: 'GoLand', bundleId: 'com.jetbrains.goland', category: AppCategory.Editor },
    { name: 'PhpStorm', bundleId: 'com.jetbrains.PhpStorm', category: AppCategory.Editor },
    { name: 'Rider', bundleId: 'com.jetbrains.rider', category: AppCategory.Editor },
    { name: 'AppCode', bundleId: 'com.jetbrains.AppCode', category: AppCategory.Editor },
    { name: 'DataGrip', bundleId: 'com.jetbrains.datagrip', category: AppCategory.Editor },
    { name: 'RustRover', bundleId: 'com.jetbrains.rustrover', category: AppCategory.Editor },
    { name: 'Fleet', bundleId: 'com.jetbrains.fleet', category: AppCategory.Editor },

    // Editors - Others
    { name: 'Atom', bundleId: 'com.github.atom', category: AppCategory.Editor },
    { name: 'BBEdit', bundleId: 'com.barebones.bbedit', category: AppCategory.Editor },
    { name: 'CotEditor', bundleId: 'com.coteditor.CotEditor', category: AppCategory.Editor },
    { name: 'MacVim', bundleId: 'org.vim.MacVim', category: AppCategory.Editor },
    { name: 'Emacs', bundleId: 'org.gnu.Emacs', category: AppCategory.Editor },
    { name: 'Brackets', bundleId: 'io.brackets.appshell', category: AppCategory.Editor },
    { name: 'TextEdit', bundleId: 'com.apple.TextEdit', category: AppCategory.Editor },

    // System
    { name: 'Finder', bundleId: 'com.apple.finder', category: AppCategory.Finder },
  ];

  private detectedApps: DetectedApp[] = [];
  private initialized = false;

  async detectApps(): Promise<DetectedApp[]> {
    if (this.initialized) {
      return this.detectedApps;
    }

    const detected: DetectedApp[] = [];
    const bundleIdToApp = new Map(AppDetector.knownApps.map((app) => [app.bundleId, app]));

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

  async openPath(path: string, bundleId: string): Promise<void> {
    const detectedApp = this.detectedApps.find((a) => a.bundleId === bundleId);
    if (!detectedApp) {
      throw new Error(`App with bundle ID ${bundleId} not found`);
    }

    await execAsync(`open -b "${bundleId}" "${path}"`);
  }

  async getAppIcon(bundleId: string): Promise<string | undefined> {
    const detectedApp = this.detectedApps.find((a) => a.bundleId === bundleId);
    if (!detectedApp) return undefined;

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

      const icnsPath = `${detectedApp.path}/Contents/Resources/${iconName}`;
      if (!existsSync(icnsPath)) return undefined;

      // Convert icns to png using sips (required for ic13 format on macOS 26+)
      const tmpPng = `/tmp/enso-icon-${bundleId.replace(/\./g, '-')}.png`;
      await execAsync(`sips -s format png -z 128 128 "${icnsPath}" --out "${tmpPng}" 2>/dev/null`);

      const pngData = await readFile(tmpPng);
      return `data:image/png;base64,${pngData.toString('base64')}`;
    } catch {
      return undefined;
    }
  }
}

export const appDetector = new AppDetector();
