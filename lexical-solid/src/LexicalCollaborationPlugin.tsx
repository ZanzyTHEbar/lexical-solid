import type { Doc } from "yjs";
import {
  type CollaborationContextType,
  useCollaborationContext,
} from "./LexicalCollaborationContext";
import { useLexicalComposerContext } from "./LexicalComposerContext";
import {
  Binding,
  createBinding,
  ExcludedProperties,
  Provider,
} from "@lexical/yjs";
import { LexicalEditor } from "lexical";
import { InitialEditorStateType } from "./LexicalComposer";
import {
  CursorsContainerRef,
  useYjsCollaboration,
  useYjsFocusTracking,
  useYjsHistory,
} from "./shared/useYjsCollaboration";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  JSX,
  on,
  onCleanup,
  Setter,
  Show,
} from "solid-js";

type Props = {
  id: string;
  providerFactory: (
    // eslint-disable-next-line no-shadow
    id: string,
    yjsDocMap: Map<string, Doc>
  ) => Provider;
  shouldBootstrap: boolean;
  username?: string;
  cursorColor?: string;
  cursorsContainerRef?: CursorsContainerRef;
  initialEditorState?: InitialEditorStateType;
  excludedProperties?: ExcludedProperties;
  // `awarenessData` parameter allows arbitrary data to be added to the awareness.
  awarenessData?: object;
};

export function CollaborationPlugin(props: Props): JSX.Element {
  const isProviderInitialized = { current: false };

  const collabContext = useCollaborationContext(
    props.username,
    props.cursorColor
  );

  const { yjsDocMap, name, color } = collabContext;

  const [editor] = useLexicalComposerContext();
  const [unsupportedDoc, setUnsupportedDoc] = createSignal<Doc>();

  createEffect(() => {
    if (unsupportedDoc()) {
      return;
    }
    collabContext.isCollabActive = true;
    // Nested editors (e.g. image captions) do not own the shared flag.
    if (editor._parentEditor == null) {
      onCleanup(() => {
        collabContext.isCollabActive = false;
      });
    }
  });

  const [provider, setProvider] = createSignal<Provider>();

  createEffect(
    on(
      () => [props.id, props.providerFactory, yjsDocMap],
      () => {
        if (isProviderInitialized.current) {
          return;
        }

        isProviderInitialized.current = true;

        const newProvider = props.providerFactory(props.id, yjsDocMap);
        setProvider(newProvider);
      }
    )
  );

  const [binding, setBinding] = createSignal<Binding>();

  createEffect(
    on(provider, (p) => {
      if (!p) {
        return;
      }
      const newBinding = createBinding(
        editor,
        p,
        props.id,
        yjsDocMap.get(props.id),
        yjsDocMap,
        props.excludedProperties
      );
      setBinding(newBinding);
      onCleanup(() => newBinding.root.destroy(newBinding));
    })
  );

  return (
    <Show
      when={provider() && binding() && !unsupportedDoc()}
      fallback={
        <Show when={unsupportedDoc()}>
          <div role="alert">
            Collaboration stopped because the provider replaced the shared
            document. Your text is still in this editor, but changes are no
            longer synced.
          </div>
        </Show>
      }
    >
      <YjsCollaborationCursors
        awarenessData={props.awarenessData}
        binding={binding()!}
        collabContext={collabContext}
        color={color}
        cursorsContainerRef={props.cursorsContainerRef}
        editor={editor}
        id={props.id}
        initialEditorState={props.initialEditorState}
        name={name}
        provider={provider()!}
        isActive={() => !unsupportedDoc()}
        setUnsupportedDoc={setUnsupportedDoc}
        shouldBootstrap={props.shouldBootstrap}
        yjsDocMap={yjsDocMap}
      />
    </Show>
  );
}

function YjsCollaborationCursors(props: {
  editor: LexicalEditor;
  id: string;
  provider: Provider;
  yjsDocMap: Map<string, Doc>;
  name: string;
  color: string;
  shouldBootstrap: boolean;
  binding: Binding;
  isActive: () => boolean;
  setUnsupportedDoc: Setter<Doc | undefined>;
  cursorsContainerRef?: CursorsContainerRef | undefined;
  initialEditorState?: InitialEditorStateType | undefined;
  awarenessData?: object;
  collabContext: CollaborationContextType;
}) {
  const binding = () => props.binding;
  const cursors = useYjsCollaboration(
    props.editor,
    props.id,
    () => props.provider,
    props.yjsDocMap,
    props.name,
    props.color,
    props.shouldBootstrap,
    binding,
    props.setUnsupportedDoc,
    props.cursorsContainerRef,
    props.initialEditorState,
    props.awarenessData
  );

  createRenderEffect(() => {
    props.collabContext.clientID = props.binding.clientID;
  })

  useYjsHistory(props.editor, binding, props.isActive);
  useYjsFocusTracking(
    props.editor,
    () => props.provider,
    props.name,
    props.color,
    props.awarenessData,
    props.isActive
  );

  return <>{cursors}</>;
}
