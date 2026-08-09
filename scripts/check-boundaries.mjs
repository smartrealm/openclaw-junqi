#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_ROOT = join(SCRIPT_DIR, '..', 'src');

export const MODULE_BOUNDARY_RULES = [
  {
    pattern: /^theme\/(?!useTheme\.ts).*/,
    forbidRuntime: ['stores/**', 'services/**', 'components/**'],
    forbidType: ['stores/**', 'services/**', 'components/**'],
    message: 'theme/* 只能包含纯计算与 DOM 副作用，不能依赖 stores/services/components。',
  },
  {
    pattern: /^theme\/useTheme\.ts$/,
    forbidRuntime: ['services/**', 'components/**'],
    forbidType: ['services/**', 'components/**'],
    message: 'theme/useTheme.ts 仅可桥接设置仓库，不能依赖 services/components。',
  },
  {
    pattern: /^services\//,
    forbidRuntime: ['stores/**', 'theme/**'],
    forbidType: ['stores/**', 'theme/**'],
    message: 'services/* 必须保持无状态，不能依赖 stores/theme。',
  },
  {
    pattern: /^components\//,
    forbidRuntime: ['services/**'],
    forbidType: [],
    message: 'components/* 不能直接依赖 services，副作用必须由状态或页面装配层持有。',
  },
  {
    pattern: /^pages\//,
    forbidRuntime: ['state/**', '@tauri-apps/api/core'],
    forbidType: ['state/**', '@tauri-apps/api/core'],
    message: 'pages/* 不能直接依赖 Rust 状态或 Tauri core，必须使用类型化 API 包装。',
  },
];

function slash(value) {
  return value.split(sep).join('/');
}

function walkSourceFiles(directory, sourceRoot, output = []) {
  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const metadata = statSync(absolutePath);
    if (metadata.isDirectory()) {
      walkSourceFiles(absolutePath, sourceRoot, output);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
      continue;
    }
    output.push({
      path: slash(relative(sourceRoot, absolutePath)),
      content: readFileSync(absolutePath, 'utf8'),
    });
  }
  return output;
}

export function extractModuleImports(content) {
  const imports = [];
  const source = ts.createSourceFile('boundary-input.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const namedBindings = clause?.namedBindings;
      const namedTypeOnly = namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements.length > 0 && namedBindings.elements.every((element) => element.isTypeOnly)
        : false;
      const typeOnly = Boolean(clause?.isTypeOnly)
        || Boolean(clause && !clause.name && namedTypeOnly);
      imports.push({ specifier: node.moduleSpecifier.text, typeOnly });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

export function matchModuleGlob(pattern, value) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function importTarget(sourcePath, specifier) {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return slash(normalize(join(dirname(sourcePath), specifier)));
  }
  return specifier;
}

function containsDirectInvoke(content) {
  return /(?:^|[^\w$.])invoke\s*\(/m.test(content);
}

export function scanModuleBoundaries(files, rules = MODULE_BOUNDARY_RULES) {
  const violations = [];
  for (const file of files) {
    if (/^pages\//.test(file.path) && containsDirectInvoke(file.content)) {
      violations.push({
        file: file.path,
        import: 'invoke(...)',
        target: 'api/tauri-commands.ts',
        rule: 'pages/* 必须使用类型化 Tauri API 包装，不能直接调用 invoke。',
      });
    }
    const imports = extractModuleImports(file.content);
    for (const rule of rules) {
      if (!rule.pattern.test(file.path)) continue;
      for (const dependency of imports) {
        const target = importTarget(file.path, dependency.specifier);
        const forbiddenPatterns = dependency.typeOnly ? rule.forbidType : rule.forbidRuntime;
        for (const forbidden of forbiddenPatterns) {
          if (target === forbidden || matchModuleGlob(forbidden, target)) {
            violations.push({
              file: file.path,
              import: dependency.specifier,
              typeOnly: dependency.typeOnly,
              target,
              rule: rule.message,
            });
          }
        }
      }
    }
  }
  return violations;
}

export function scanSourceRoot(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const root = resolve(sourceRoot);
  const files = walkSourceFiles(root, root);
  return { files, violations: scanModuleBoundaries(files) };
}

export function runBoundaryCheck(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const { files, violations } = scanSourceRoot(sourceRoot);
  if (violations.length === 0) {
    console.log(`PASS Module boundaries clean (checked ${files.length} files)`);
    return 0;
  }
  console.error(`FAIL Module boundary violations (${violations.length}):\n`);
  for (const violation of violations) {
    console.error(`  ${violation.file}`);
    console.error(`    imports "${violation.import}" -> ${violation.target}`);
    console.error(`    ${violation.rule}\n`);
  }
  return 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  process.exitCode = runBoundaryCheck();
}
