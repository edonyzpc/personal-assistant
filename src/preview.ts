import component from './components/Component.svelte'

import { ItemView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_EXAMPLE = "example-view";

export class ExampleView extends ItemView {
  component: component;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_EXAMPLE;
  }

  getDisplayText() {
    return "Example view";
  }

    async onOpen() {
        console.log("opening...");
        this.component = new component({
            target: this.contentEl,
                props: {
                variable: 1
            }
        });
  }

  async onClose() {
    this.component.$destroy();
  }
}