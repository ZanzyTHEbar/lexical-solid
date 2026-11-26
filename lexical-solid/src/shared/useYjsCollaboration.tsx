import {
  Binding,
  Provider,
  CONNECTED_COMMAND,
  createBinding,
  createUndoManager,
  initLocalState,
  setLocalStateFocus,
  syncCursorPositions,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  TOGGLE_CONNECT_COMMAND,
  SyncCursorPositionsFn,
} from "@lexical/yjs";
import {
  type EditorUpdateOptions,
  LexicalEditor,
  $addUpdateTag,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  BLUR_COMMAND,
  CAN_UNDO_COMMAND,
  CAN_REDO_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FOCUS_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { type Doc, type Transaction, type YEvent, UndoManager } from "yjs";
import { mergeRegister } from "@lexical/utils";
import { InitialEditorStateType } from "../LexicalComposer";
import { JSX, Setter } from "solid-js";
import { Portal } from "solid-js/web";
import {
  Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
} from "solid-js";

export type CursorsContainerRef = Accessor<HTMLElement | undefined | null>;

const BOOTSTRAP_TAG = "lexical-solid-collaboration-bootstrap";

function guardInboundBinding(binding: Binding, isActive: () => boolean): Binding {
  const editor = binding.editor;
  const update = (apply: () => void, options?: EditorUpdateOptions) => {
    if (!isActive()) {
      return;
    }
    const onUpdate = options?.onUpdate;
    editor.update(
      () => {
        if (isActive()) {
          apply();
        }
      },
      options && {
        ...options,
        // Lexical reads these when it drains a nested update. A retired
        // update must not tag the enclosing edit or suppress its transforms.
        get tag() {
          return isActive() ? options.tag : undefined;
        },
        get skipTransforms() {
          return isActive() ? options.skipTransforms : undefined;
        },
        onUpdate: onUpdate && (() => {
          if (isActive()) {
            onUpdate();
          }
        }),
      }
    );
  };
  // Keep Yjs event capture synchronous and use the real editor queue. Only
  // the inbound helper sees this adapter, including its empty-root update.
  const guardedEditor = new Proxy(editor, {
    get(target, key) {
      if (key === "update") {
        return update;
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" && key !== "constructor"
        ? value.bind(target)
        : value;
    },
  });
  return new Proxy(binding, {
    get(target, key) {
      return key === "editor" ? guardedEditor : Reflect.get(target, key);
    },
  });
}

export function useYjsCollaboration(
  editor: LexicalEditor,
  id: string,
  provider: Accessor<Provider>,
  docMap: Map<string, Doc>,
  name: string,
  color: string,
  shouldBootstrap: boolean,
  binding: Accessor<Binding>,
  setUnsupportedDoc: Setter<Doc | undefined>,
  cursorsContainerRef?: CursorsContainerRef,
  initialEditorState?: InitialEditorStateType,
  awarenessData?: object,
  syncCursorPositionsFn: SyncCursorPositionsFn = syncCursorPositions
): Accessor<JSX.Element> {
  let stopped = false;
  let toggleConnection: ((shouldConnect: boolean) => void) | undefined;

  createEffect(
    on(binding, () => {
      const currentBinding = binding();
      const { doc, root } = currentBinding;
      const sharedRoot = root.getSharedType();
      const currentProvider = provider();
      const { awareness } = currentProvider;
      const bootstrapOrigin = Symbol(BOOTSTRAP_TAG);
      let active = true;
      let synced = false;
      const isActive = () => active && !stopped;
      const inboundBinding = guardInboundBinding(currentBinding, isActive);
      const canBootstrap = () =>
        isActive() && synced && root.isEmpty() && sharedRoot.length === 0;

      const disconnect = () => {
        try {
          currentProvider.disconnect();
        } catch {
          // A provider error must not leave the editor bound to a retired doc.
        }
      };

      const connect = () => {
        if (!isActive()) {
          return;
        }
        const disconnectIfStopped = () => {
          if (!isActive()) {
            disconnect();
          }
        };
        const pending = currentProvider.connect();
        if (pending) {
          void pending.then(disconnectIfStopped, disconnectIfStopped);
        } else {
          // A synchronous connect may finish opening after a reentrant reload.
          disconnectIfStopped();
        }
      };

      toggleConnection = (shouldConnect) => {
        if (!isActive()) {
          return;
        }
        if (shouldConnect) {
          // eslint-disable-next-line no-console
          console.log("Collaboration connected!");
          connect();
        } else {
          // eslint-disable-next-line no-console
          console.log("Collaboration disconnected!");
          disconnect();
        }
      };

      const onStatus = ({ status }: { status: string }) => {
        if (isActive()) {
          if (status !== "connected") {
            synced = false;
          }
          editor.dispatchCommand(CONNECTED_COMMAND, status === "connected");
        }
      };

      const onSync = (isSynced: boolean) => {
        synced = isSynced;
        if (!shouldBootstrap || !canBootstrap()) {
          return;
        }

        // A provider can emit sync from inside a Lexical update or Yjs
        // transaction. Commit any pending editor work before tagging the seed.
        queueMicrotask(() => {
          if (
            canBootstrap() &&
            editor.read(() => $getRoot().isEmpty()) &&
            canBootstrap()
          ) {
            initializeEditor(editor, initialEditorState);
          }
        });
      };

      const onAwarenessUpdate = () => {
        if (isActive()) {
          syncCursorPositionsFn(currentBinding, currentProvider);
        }
      };

      const onYjsTreeChanges = (
        // The below `any` type is taken directly from the vendor types for YJS.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events: Array<YEvent<any>>,
        transaction: Transaction
      ) => {
        const origin = transaction.origin;
        if (
          isActive() &&
          origin !== currentBinding &&
          origin !== bootstrapOrigin
        ) {
          const isFromUndoManager = origin instanceof UndoManager;
          syncYjsChangesToLexical(
            inboundBinding,
            currentProvider,
            events,
            isFromUndoManager,
            onAwarenessUpdate
          );
        }
      };

      const onProviderDocReload = (ydoc: Doc) => {
        if (!isActive() || ydoc === doc) {
          return;
        }
        stopped = true;
        setUnsupportedDoc(ydoc);
        disconnect();
        editor.dispatchCommand(CONNECTED_COMMAND, false);
        editor.dispatchCommand(CAN_UNDO_COMMAND, false);
        editor.dispatchCommand(CAN_REDO_COMMAND, false);
      };

      // This updates the local editor state when we receive updates from other clients
      sharedRoot.observeDeep(onYjsTreeChanges);
      const removeListener = editor.registerUpdateListener(
        ({
          prevEditorState,
          editorState,
          dirtyLeaves,
          dirtyElements,
          normalizedNodes,
          tags,
        }) => {
          if (!isActive() || tags.has("skip-collab")) {
            return;
          }
          const syncUpdate = () =>
            syncLexicalUpdateToYjs(
              currentBinding,
              currentProvider,
              prevEditorState,
              editorState,
              dirtyElements,
              dirtyLeaves,
              normalizedNodes,
              tags
            );
          if (tags.has(BOOTSTRAP_TAG)) {
            // The nested Lexical Yjs write inherits this untracked origin.
            // Unlike a binding-wide flag, the origin belongs to this transaction.
            doc.transact(syncUpdate, bootstrapOrigin);
          } else {
            syncUpdate();
          }
        }
      );
      onCleanup(() => {
        active = false;
        toggleConnection = undefined;
        currentProvider.off("sync", onSync);
        currentProvider.off("status", onStatus);
        currentProvider.off("reload", onProviderDocReload);
        awareness.off("update", onAwarenessUpdate);
        sharedRoot.unobserveDeep(onYjsTreeChanges);
        if (docMap.get(id) === doc) {
          docMap.delete(id);
        }
        removeListener();
        if (!stopped) {
          disconnect();
        }
      });
      currentProvider.on("reload", onProviderDocReload);
      currentProvider.on("status", onStatus);
      currentProvider.on("sync", onSync);
      awareness.on("update", onAwarenessUpdate);
      // Awareness publication can synchronously replace the document.
      if (!isActive()) {
        return;
      }
      initLocalState(
        currentProvider,
        name,
        color,
        document.activeElement === editor.getRootElement(),
        awarenessData || {}
      );
      connect();
    })
  );
  const cursorsContainer = createMemo(() => {
    const ref = (element: null | HTMLElement) => {
      binding().cursorsContainer = element;
    };

    const mountPoint =
      (cursorsContainerRef && cursorsContainerRef()) || document.body;

    return (
      <Portal mount={mountPoint}>
        <div ref={ref} />
      </Portal>
    );
  });

  onCleanup(
    editor.registerCommand(
      TOGGLE_CONNECT_COMMAND,
      (shouldConnect) => {
        toggleConnection?.(shouldConnect);
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    )
  );

  return cursorsContainer;
}

export function useYjsFocusTracking(
  editor: LexicalEditor,
  provider: Accessor<Provider>,
  name: string,
  color: string,
  awarenessData?: object,
  isActive: Accessor<boolean> = () => true
) {
  onCleanup(
    mergeRegister(
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          if (!isActive()) {
            return false;
          }
          setLocalStateFocus(
            provider(),
            name,
            color,
            true,
            awarenessData || {}
          );
          return false;
        },
        COMMAND_PRIORITY_EDITOR
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          if (!isActive()) {
            return false;
          }
          setLocalStateFocus(
            provider(),
            name,
            color,
            false,
            awarenessData || {}
          );
          return false;
        },
        COMMAND_PRIORITY_EDITOR
      )
    )
  );
}

export function useYjsHistory(
  editor: LexicalEditor,
  binding: Accessor<Binding>,
  isActive: Accessor<boolean> = () => true
): () => void {
  const undoManager = createMemo(() => {
    const currentBinding = binding();
    const manager = createUndoManager(
      currentBinding,
      currentBinding.root.getSharedType()
    );
    onCleanup(() => manager.destroy());
    return manager;
  });

  onMount(() => {
    const undo = () => {
      if (isActive()) {
        undoManager().undo();
      }
    };

    const redo = () => {
      if (isActive()) {
        undoManager().redo();
      }
    };

    onCleanup(
      mergeRegister(
        editor.registerCommand(
          UNDO_COMMAND,
          () => {
            undo();
            return true;
          },
          COMMAND_PRIORITY_EDITOR
        ),
        editor.registerCommand(
          REDO_COMMAND,
          () => {
            redo();
            return true;
          },
          COMMAND_PRIORITY_EDITOR
        )
      )
    );
  });
  const clearHistory = () => {
    undoManager().clear();
  };

  // Exposing undo and redo states
  createEffect(() => {
    const manager = undoManager();
    const updateUndoRedoStates = () => {
      editor.dispatchCommand(
        CAN_UNDO_COMMAND,
        isActive() && manager.undoStack.length > 0
      );
      editor.dispatchCommand(
        CAN_REDO_COMMAND,
        isActive() && manager.redoStack.length > 0
      );
    };
    manager.on("stack-item-added", updateUndoRedoStates);
    manager.on("stack-item-popped", updateUndoRedoStates);
    manager.on("stack-cleared", updateUndoRedoStates);
    onCleanup(() => {
      manager.off("stack-item-added", updateUndoRedoStates);
      manager.off("stack-item-popped", updateUndoRedoStates);
      manager.off("stack-cleared", updateUndoRedoStates);
    });
  });

  return clearHistory;
}

function initializeEditor(
  editor: LexicalEditor,
  initialEditorState: InitialEditorStateType | undefined
): void {
  editor.update(
    () => {
      const root = $getRoot();

      if (root.isEmpty()) {
        if (initialEditorState) {
          switch (typeof initialEditorState) {
            case "string": {
              const parsedEditorState =
                editor.parseEditorState(initialEditorState);
              editor.setEditorState(parsedEditorState, {
                 tag: BOOTSTRAP_TAG,
              });
              break;
            }
            case "object": {
              editor.setEditorState(initialEditorState, {
                 tag: BOOTSTRAP_TAG,
              });
              break;
            }
            case "function": {
              $addUpdateTag(BOOTSTRAP_TAG);
              initialEditorState(editor);
              break;
            }
          }
        } else {
          $addUpdateTag(BOOTSTRAP_TAG);
          const paragraph = $createParagraphNode();
          root.append(paragraph);
          const { activeElement } = document;

          if (
            $getSelection() !== null ||
            (activeElement !== null &&
              activeElement === editor.getRootElement())
          ) {
            paragraph.select();
          }
        }
      }
    },
    {
      discrete: true,
      tag: "history-merge",
    }
  );
}
