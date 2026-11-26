# Lexical Solid for ZenWriter

A Solid 1.x adapter for Lexical 0.53.0, based on the Solid port of [`@lexical/react`](https://www.npmjs.com/package/@lexical/react).

## Install the local artifact

This fork builds a local tarball named `@zanzythebar/lexical-solid@0.22.0`. This name does not imply registry availability. From the repository root, use the pinned pnpm 10 version:

```sh
pnpm install --frozen-lockfile
pnpm -C lexical-solid pack
```

Packing builds the adapter and includes this README and both licenses. In your application, install the resulting tarball:

```sh
npm install /path/to/zanzythebar-lexical-solid-0.22.0.tgz solid-js@^1.7.11 lexical@0.53.0 @lexical/yjs@0.53.0 yjs@^13.6.20
```

## Runtime and TypeScript

- Use ESM imports, Node 20 or newer for Node SSR and build tooling, and Solid `^1.7.11` (1.x). The browser build is the default for bundlers; the `solid` condition selects uncompiled JSX/source for bundlers configured to compile it. Node's default ESM resolution selects the compiled SSR build. There is no `require()` entrypoint.
- Use TypeScript 5.8 or newer with `"module": "ESNext"` and `"moduleResolution": "bundler"`, including when type-checking an app that runs Node SSR. `node16`, `nodenext`, and legacy `node` resolution are not supported for these declarations.
- Pin `lexical` and the `@lexical/*` packages you import to `0.53.0`. Keep the editor, adapter, `@lexical/yjs`, and any collaboration provider on the same ESM dependency graph. The provider must use the **same ESM Yjs instance** as the adapter: create and share its `Doc` via `import { Doc } from "yjs"`. Do not use a provider that loads Yjs via `require()` or bundles its own copy. Importing such a provider from ESM does not change how it loads Yjs.

## Collaboration provider reloads

Providers must keep the same `Y.Doc` for the lifetime of a mounted `CollaborationPlugin`. Reconnecting to that document is supported. If the provider emits `reload` with a different `Y.Doc`, the plugin disconnects and displays a warning. The editor keeps its current text in memory; subsequent edits are not synced. Save or copy that text before remounting a fresh collaboration session.

## Migrate imports

Replace the `lexical-solid` prefix with `@zanzythebar/lexical-solid`. The ZenWriter subpaths `LexicalComposer`, `LexicalRichTextPlugin`, `LexicalContentEditable`, `LexicalComposerContext`, `LexicalErrorBoundary`, and `LexicalHistoryPlugin` keep their names.

- The root `TreeView` is the editor-connected component (also available from `/LexicalTreeView`), with an explicit `editor` prop. Use `/TreeView` for the lower-level view that takes `editorState` and callbacks (`generateContent`, `setEditorState`, `setEditorReadOnly`, and `ref`). Both use class props such as `viewClassName` and `timeTravelPanelClassName`, not `viewClass` and `timeTravelPanelClass`.
- The root also exports `generateContent`, `registerLexicalCommandLogger`, `useLexicalCommandsLog`, and the types `CustomPrintNodeFn` and `LexicalCommandLog`. The `/generateContent` and `/useLexicalCommandsLog` subpaths remain available.

## License

See [LICENSE](./LICENSE) and the [upstream license](./LICENSE-UPSTREAM) for `@lexical/react`.
