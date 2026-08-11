import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = fileURLToPath(new URL('../', import.meta.url));

/**
 * 十六进制颜色只允许用于颜色本身就是内容，或主题初始化前无法读取应用令牌的致命错误界面。
 * 产品界面必须使用 --aegis-* 语义令牌。
 */
// 精确记录已审查的出现次数，避免混合文件在未复核语义的情况下继续增加颜色字面量。
const REVIEWED_HEX_OCCURRENCES: Readonly<Record<string, number>> = {
  'components/Chat/MessageBubble.tsx': 1, // 沙箱 HTML 预览纸张色
  'components/FileExplorer/fileViewerCapabilities.ts': 15, // 语言与文件类型标识色
  'components/Git/DiffFileBlock.tsx': 0, // 差异语义色
  'components/Git/GitDiffViewer.tsx': 0,
  'components/Git/GitFileBrowser.tsx': 0,
  'components/Git/GitHistory.tsx': 0,
  'components/Git/types.ts': 7,
  'components/Terminal/PaneSearchBar.tsx': 0, // xterm 搜索装饰色从当前主题解析
  'components/Terminal/terminalShared.ts': 20, // xterm 回退契约
  'components/settings/ThemePicker.tsx': 11, // 主题色板和预览画布
  'pages/SetupPage/WizardScreen.tsx': 0, // 向导改由主题令牌呈现，不保留硬编码颜色
  'pages/SetupPage/shared.tsx': 10, // 主题色板
  'pet/PetBubble.tsx': 0,
  'pet/PetCharacter.tsx': 3,
  'pet/backdropContrast.ts': 0,
  'pet/effects.tsx': 1,
  'pet/petTheme.ts': 44,
  'pet/pomodoroView.ts': 4,
  'pet/skins/index.tsx': 13, // 萌宠绘图色板
  'runtime/fatalErrorOverlay.ts': 3, // React 启动前的紧急错误界面
  'styles/primitives.css': 10, // 固定的数据可视化基础色
  'styles/terminal-kooky.css': 0, // 终端界面必须使用语义主题令牌
  'styles/terminal.css': 0, // 终端与 ANSI 主题别名
  'styles/themes/aegis-dark.css': 30,
  'styles/themes/aegis-eyecare.css': 30,
  'styles/themes/aegis-light.css': 24,
  'styles/themes/aegis-midnight.css': 33, // 语义令牌定义
  'utils/theme-colors.ts': 1, // 令牌转换回退值和说明
  'utils/qrCode.ts': 2, // 二维码像素内容色必须保持稳定黑白对比
};

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (['.ts', '.tsx', '.css'].includes(extname(entry.name)) && !entry.name.includes('.test.')) result.push(path);
    }
  };
  walk(root);
  return result;
}

function executableSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('BUG-FCA-08 product chrome does not introduce unclassified hex colors', () => {
  const files = sourceFiles(srcRoot)
    .map((path) => ({ path, relativePath: relative(srcRoot, path) }));
  const offenders: string[] = [];
  const reviewedPaths = new Set(Object.keys(REVIEWED_HEX_OCCURRENCES));

  for (const { path, relativePath } of files) {
    const source = executableSource(readFileSync(path, 'utf8'));
    const count = source.match(/#[0-9a-fA-F]{3,8}\b/g)?.length ?? 0;
    const reviewedCount = REVIEWED_HEX_OCCURRENCES[relativePath];
    if (reviewedCount === undefined) {
      if (count > 0) offenders.push(`${relativePath}: ${count} unclassified`);
      continue;
    }
    reviewedPaths.delete(relativePath);
    if (count !== reviewedCount) {
      offenders.push(`${relativePath}: expected ${reviewedCount}, found ${count}`);
    }
  }

  for (const stalePath of reviewedPaths) offenders.push(`${stalePath}: stale review entry`);
  assert.deepEqual(
    offenders,
    [],
    `Replace product chrome colors with semantic tokens or review the exact content-color budget: ${offenders.join(', ')}`,
  );
});
