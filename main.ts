import {
  App,
  MarkdownPostProcessorContext,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem
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

const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

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
    const loaded = (await this.loadData()) as Partial<TimeStampHiderSettings> | null;
    this.settingsData = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
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
    const app = this.app;
    const getRegex = () => this.getRegex();
    const hideTimeStamp = (text: string) => this.hideTimeStamp(text);
    const isEnabled = () => this.settingsData.enabled;
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
        const span = view.contentDOM.ownerDocument.createElement("span");
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

          const sourcePath = app.workspace.getActiveFile()?.path ?? "";
          const newLeaf =
            event instanceof MouseEvent && (event.ctrlKey || event.metaKey);

          void app.workspace.openLinkText(this.target, sourcePath, newLeaf);
        };

        // Keep Live Preview stable while the mouse is held down. On click,
        // Obsidian/CodeMirror gets the cursor back and reveals the source link.
        span.addEventListener("mousedown", (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
        });
        span.addEventListener("click", (event: MouseEvent) => {
          if (event.ctrlKey || event.metaKey) {
            openTarget(event);
            return;
          }

          editLink(event);
        });
        span.addEventListener("keydown", (event: KeyboardEvent) => {
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

      if (!isEnabled() || !getRegex()) {
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
          const display = hideTimeStamp(fileName);

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

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Time stamp hider",
        items: [
          {
            name: "Hide timestamp",
            desc: "Hide matching timestamp prefixes in rendered internal link text.",
            control: {
              type: "toggle",
              key: "enabled",
              defaultValue: DEFAULT_SETTINGS.enabled
            }
          },
          {
            name: "Timestamp regular expression",
            desc: "Default: ^\\d{10}\\s+",
            control: {
              type: "text",
              key: "pattern",
              defaultValue: DEFAULT_SETTINGS.pattern,
              placeholder: DEFAULT_SETTINGS.pattern,
              validate: (value) => validatePattern(value)
            }
          }
        ]
      }
    ];
  }

  getControlValue(key: string): unknown {
    switch (key) {
      case "enabled":
        return this.plugin.settingsData.enabled;
      case "pattern":
        return this.plugin.settingsData.pattern;
      default:
        return undefined;
    }
  }

  async setControlValue(key: string, value: unknown) {
    switch (key) {
      case "enabled":
        this.plugin.settingsData.enabled =
          typeof value === "boolean" ? value : DEFAULT_SETTINGS.enabled;
        break;
      case "pattern":
        this.plugin.settingsData.pattern =
          typeof value === "string" && value.trim()
            ? value.trim()
            : DEFAULT_SETTINGS.pattern;
        break;
      default:
        return;
    }

    await this.plugin.saveSettings();
  }
}

function validatePattern(value: string) {
  try {
    new RegExp(value.trim() || DEFAULT_SETTINGS.pattern);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid regular expression";
  }
}
