import { rollup } from 'rollup';
import ts from 'typescript';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { babel } from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import fg from 'fast-glob';

const rootDir = resolve('src');
const input = fg.sync('src/**/*.{ts,tsx}', { absolute: true }).sort();
const isExternal = (id) => /^(lexical|@lexical\/[^/]+|solid-js|yjs)(\/|$)/.test(id);

const program = ts.createProgram(input, {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  jsxImportSource: 'solid-js',
  strict: true,
  rootDir,
  outDir: 'dist/source',
  declarationDir: 'dist/types',
  declaration: true,
  noEmitOnError: true,
});

rmSync('dist', { recursive: true, force: true });
const { diagnostics, emitSkipped } = program.emit();
if (emitSkipped) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  }));
}

async function build(generate, directory) {
  const bundle = await rollup({
    input,
    external: isExternal,
    preserveEntrySignatures: 'strict',
    plugins: [
      nodeResolve({ extensions: ['.js', '.jsx', '.ts', '.tsx'] }),
      babel({
        babelHelpers: 'bundled',
        babelrc: false,
        configFile: false,
        extensions: ['.ts', '.tsx'],
        presets: [
          ['babel-preset-solid', { generate, hydratable: true }],
          '@babel/preset-typescript',
        ],
      }),
    ],
  });
  try {
    await bundle.write({
      dir: `dist/${directory}`,
      format: 'esm',
      preserveModules: true,
      preserveModulesRoot: rootDir,
    });
  } finally {
    await bundle.close();
  }
}

await build('dom', 'esm');
await build('ssr', 'ssr');
