import {
  App,
  MarkdownPostProcessorContext,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting
} from "obsidian";
import { Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType
} from "@codemirror/view";

interface TimeStampHiderSettings {
  enabled: boolean;
  pattern: string;
}

const DEFAULT_SETTINGS: TimeStampHiderSettings = {
  enabled: true,
  pattern: "^\\d{10}\\s+"
};

const WIKI_LINK_PATTERN = /\[\[([^\]\|\#]+)(?:#[^\]\|]*)?(?:\|([^\]]+))?\]\]/g;

export default class TimeStampHiderPlugin extends Plugin {
  settingsData: TimeStampHiderSettings;
  private editorExtension: Extension;

  async onload() {
    await this.loadSettings();

    this.editorExtension = this.createLivePreviewExtension();
    this.registerEditorExtension(this.editorExtension);
    this.registerMarkdownPostProcessor((element, context) =>
      this.processMarkdownLinks(element, context)
    );

    this.addSettingTab(new TimeStampHiderSettingTab(this.app, this));
  }

  onunload() {
    // Obsidian automatically unloads registered post processors and editor extensions.
  }

  async loadSettings() {
    this.settingsData = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settingsData);
    this.app.workspace.updateOptions();
  }

  getRegex(): RegExp | null {
    try {
      return new RegExp(this.settingsData.pattern);
    } catch {
      return null;
    }
  }

  getPatternError(): string | null {
    try {
      new RegExp(this.settingsData.pattern);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid regular expression";
    }
  }

  hideTimeStamp(text: string): string {
    if (!this.settingsData.enabled) {
      return text;
    }

    const regex = this.getRegex();
    if (!regex) {
      return text;
    }

    return text.replace(regex, "");
  }

  private processMarkdownLinks(
    element: HTMLElement,
    _context: MarkdownPostProcessorContext
  ) {
    if (!this.settingsData.enabled || !this.getRegex()) {
      return;
    }

    element.querySelectorAll<HTMLElement>("a.internal-link").forEach((link) => {
      const original = link.textContent ?? "";
      const display = this.hideTimeStamp(original);

      if (display && display !== original) {
        link.textContent = display;
      }
    });
  }

  private createLivePreviewExtension(): Extension {
    const plugin = this;
    let pointerIsDown = false;

    class HiddenTimeStampWidget extends WidgetType {
      constructor(
        private readonly displayText: string,
        private readonly target: string,
        private readonly from: number,
        private readonly to: number
      ) {
        super();
      }

      eq(other: HiddenTimeStampWidget) {
        return this.displayText === other.displayText && this.target === other.target;
      }

      toDOM(view: EditorView) {
        const span = document.createElement("span");
        span.addClass("cm-hmd-internal-link", "cm-link", "cm-underline");
        span.setAttr("role", "link");
        span.setAttr("tabindex", "0");
        span.textContent = this.displayText;

        const editLink = (event: MouseEvent | KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();

          view.focus();
          view.dispatch({
            selection: { anchor: Math.min(this.from + 2, this.to) },
            scrollIntoView: true
          });
        };

        const openTarget = (event: MouseEvent | KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();

          const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? "";
          const newLeaf =
            event instanceof MouseEvent && (event.ctrlKey || event.metaKey);

          plugin.app.workspace.openLinkText(this.target, sourcePath, newLeaf);
        };

        // Keep Live Preview stable while the mouse is held down. On click,
        // Obsidian/CodeMirror gets the cursor back and reveals the source link.
        span.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        span.addEventListener("click", (event) => {
          if (event.ctrlKey || event.metaKey) {
            openTarget(event);
            return;
          }

          editLink(event);
        });
        span.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            editLink(event);
          }
        });

        return span;
      }

      ignoreEvent(event: Event) {
        return event.type === "mousedown" || event.type === "pointerdown";
      }
    }

    const buildDecorations = (view: EditorView): DecorationSet => {
      const builder = new RangeSetBuilder<Decoration>();

      if (!plugin.settingsData.enabled || !plugin.getRegex()) {
        return builder.finish();
      }

      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        let match: RegExpExecArray | null;

        WIKI_LINK_PATTERN.lastIndex = 0;
        while ((match = WIKI_LINK_PATTERN.exec(text)) !== null) {
          const alias = match[2];
          if (alias) {
            continue;
          }

          const target = match[1];
          const fileName = target.split("/").pop() ?? target;
          const display = plugin.hideTimeStamp(fileName);

          if (!display || display === fileName) {
            continue;
          }

          const linkStart = from + match.index;
          const linkEnd = linkStart + match[0].length;

          if (!pointerIsDown && selectionTouchesRange(view, linkStart, linkEnd)) {
            continue;
          }

          builder.add(
            linkStart,
            linkEnd,
            Decoration.replace({
              widget: new HiddenTimeStampWidget(display, target, linkStart, linkEnd),
              inclusive: false
            })
          );
        }
      }

      return builder.finish();
    };

    const livePreviewPlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
        }

        rebuild(view: EditorView) {
          this.decorations = buildDecorations(view);
        }

        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
            update.transactions.some((transaction) => transaction.reconfigured)
          ) {
            this.decorations = buildDecorations(update.view);
          }
        }
      },
      {
        decorations: (value) => value.decorations,
        eventHandlers: {
          pointerdown: () => {
            pointerIsDown = true;
          },
          pointerup: (_event, view) => {
            pointerIsDown = false;
            view.plugin(livePreviewPlugin)?.rebuild(view);
          },
          pointercancel: (_event, view) => {
            pointerIsDown = false;
            view.plugin(livePreviewPlugin)?.rebuild(view);
          }
        }
      }
    );

    return livePreviewPlugin;
  }
}

function selectionTouchesRange(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some((range) => {
    return range.from <= to && range.to >= from;
  });
}

class TimeStampHiderSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TimeStampHiderPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Time Stamp Hider" });

    new Setting(containerEl)
      .setName("Hide timestamp")
      .setDesc("Hide matching timestamp prefixes in rendered internal link text.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settingsData.enabled)
          .onChange(async (value) => {
            this.plugin.settingsData.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    const patternError = this.plugin.getPatternError();
    const regexSetting = new Setting(containerEl)
      .setName("Timestamp regular expression")
      .setDesc(
        patternError
          ? `Invalid regular expression: ${patternError}`
          : "Default: ^\\d{10}\\s+"
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.pattern)
          .setValue(this.plugin.settingsData.pattern)
          .onChange(async (value) => {
            this.plugin.settingsData.pattern = value.trim() || DEFAULT_SETTINGS.pattern;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (patternError) {
      regexSetting.settingEl.addClass("time-stamp-hider-invalid-setting");
      new Notice("Time Stamp Hider: invalid regular expression");
    }
  }
}
