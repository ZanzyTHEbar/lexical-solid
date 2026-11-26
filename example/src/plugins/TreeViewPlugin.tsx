import { useLexicalComposerContext } from "@zanzythebar/lexical-solid/LexicalComposerContext";
import { TreeView } from "@zanzythebar/lexical-solid/LexicalTreeView";

export default function TreeViewPlugin() {
  const [editor] = useLexicalComposerContext();
  return (
    <TreeView
      viewClass="tree-view-output"
      timeTravelPanelClass="debug-timetravel-panel"
      timeTravelButtonClass="debug-timetravel-button"
      timeTravelPanelSliderClass="debug-timetravel-panel-slider"
      timeTravelPanelButtonClass="debug-timetravel-panel-button"
      editor={editor}
    />
  );
}
