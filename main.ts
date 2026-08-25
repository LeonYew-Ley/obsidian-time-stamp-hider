import {
  App,
  MarkdownPostProcessorContext,
  Plugin,
  PluginSettingTab,
  Platform,
  Setting
} from "obsidian";
import { EditorSelection, Extension, RangeSetBuilder } from "@codemirror/state";
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
  hideTabTitles: boolean;
  hideInlineTitles: boolean;
  pattern: string;
}

const DEFAULT_SETTINGS: TimeStampHiderSettings = {
  enabled: true,
  hideTabTitles: false,
  hideInlineTitles: false,
  pattern: "^\\d{10}\\s+"
};

const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const TAB_TITLE_SELECTOR = ".workspace-tab-header-inner-title";
const INLINE_TITLE_SELECTOR = ".inline-title";
const TITLE_SELECTOR = `${TAB_TITLE_SELECTOR}, ${INLINE_TITLE_SELECTOR}`;

interface TitleState {
  sourceText: string;
  displayText: string;
}

interface MutationObserverWindow extends Window {
  MutationObserver: typeof MutationObserver;
}

export default class TimeStampHiderPlugin extends Plugin {
  settingsData: TimeStampHiderSettings;
  private editorExtension: Extension;
  private readonly titleObservers = new Map<Document, MutationObserver>();
  private titleRefreshScheduled = false;
  private readonly titleStates = new Map<HTMLElement, TitleState>();

  async onload() {
    await this.loadSettings();

    this.editorExtension = this.createLivePreviewExtension();
    this.registerEditorExtension(this.editorExtension);
    this.registerMarkdownPostProcessor((element, context) =>
      this.processMarkdownLinks(element, context)
    );
    this.startTitleObserver();

    this.addSettingTab(new TimeStampHiderSettingTab(this.app, this));
  }

  onunload() {
    this.stopTitleObserver();
  }

  async loadSettings() {
    const loaded = (await this.loadData()) as Partial<TimeStampHiderSettings> | null;
    this.settingsData = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settingsData);
    this.app.workspace.updateOptions();
    this.refreshTitleVisibility();
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

  private stripTimeStamp(text: string): string {
    const regex = this.getRegex();
    return regex ? text.replace(regex, "") : text;
  }

  private startTitleObserver() {
    this.observeDocument(this.app.workspace.containerEl.doc);
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.observeDocument(leaf.getContainer().doc);
    });

    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, window) => {
      this.observeDocument(window.document);
    }));
    this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, window) => {
      this.titleObservers.get(window.document)?.disconnect();
      this.titleObservers.delete(window.document);
    }));

    this.refreshTitleVisibility();
  }

  private observeDocument(doc: Document) {
    if (this.titleObservers.has(doc)) {
      return;
    }

    const DocumentMutationObserver = (doc.win as MutationObserverWindow)
      .MutationObserver;
    const observer = new DocumentMutationObserver((mutations) => {
      if (mutations.some((mutation) => this.mutationAffectsTitles(mutation))) {
        this.scheduleTitleRefresh();
      }
    });

    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    this.titleObservers.set(doc, observer);

    this.registerDomEvent(doc, "focusin", () => {
      if (doc.activeElement?.closest(INLINE_TITLE_SELECTOR)) {
        this.refreshTitleVisibility();
      }
    });
    this.registerDomEvent(doc, "focusout", () => {
      this.scheduleTitleRefresh();
    });
  }

  private stopTitleObserver() {
    for (const observer of this.titleObservers.values()) {
      observer.disconnect();
    }
    this.titleObservers.clear();
    this.titleRefreshScheduled = false;

    for (const [element, state] of this.titleStates) {
      if (element.isConnected && element.textContent === state.displayText) {
        element.textContent = state.sourceText;
      }
    }
    this.titleStates.clear();
  }

  private mutationAffectsTitles(mutation: MutationRecord): boolean {
    const targetElement = mutation.target.instanceOf(Element)
      ? mutation.target
      : mutation.target.parentElement;

    if (targetElement?.closest(TITLE_SELECTOR)) {
      return true;
    }

    return Array.from(mutation.addedNodes).some((node) => {
      return node.instanceOf(Element) &&
        (node.matches(TITLE_SELECTOR) || node.querySelector(TITLE_SELECTOR) !== null);
    });
  }

  private scheduleTitleRefresh() {
    if (this.titleRefreshScheduled) {
      return;
    }

    this.titleRefreshScheduled = true;
    queueMicrotask(() => {
      this.titleRefreshScheduled = false;
      this.refreshTitleVisibility();
    });
  }

  refreshTitleVisibility() {
    for (const doc of this.titleObservers.keys()) {
      doc.querySelectorAll<HTMLElement>(TAB_TITLE_SELECTOR).forEach((element) => {
        this.updateTitleElement(element, this.settingsData.hideTabTitles);
      });
      doc.querySelectorAll<HTMLElement>(INLINE_TITLE_SELECTOR).forEach((element) => {
        this.updateTitleElement(element, this.settingsData.hideInlineTitles);
      });
    }

    for (const element of this.titleStates.keys()) {
      if (!element.isConnected) {
        this.titleStates.delete(element);
      }
    }
  }

  private updateTitleElement(element: HTMLElement, shouldHide: boolean) {
    const currentText = element.textContent ?? "";
    const previousState = this.titleStates.get(element);

    if (!shouldHide) {
      if (previousState && currentText === previousState.displayText) {
        element.textContent = previousState.sourceText;
      }
      this.titleStates.delete(element);
      return;
    }

    const sourceText = previousState && currentText === previousState.displayText
      ? previousState.sourceText
      : currentText;
    const strippedText = this.stripTimeStamp(sourceText);
    const displayText = strippedText || sourceText;
    const activeElement = element.doc.activeElement;
    const isEditingInlineTitle = element.matches(INLINE_TITLE_SELECTOR) &&
      activeElement !== null &&
      (activeElement === element || element.contains(activeElement));
    const desiredText = isEditingInlineTitle ? sourceText : displayText;

    this.titleStates.set(element, { sourceText, displayText });
    if (currentText !== desiredText) {
      element.textContent = desiredText;
    }
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
    const isMobileApp =
      Platform.isMobileApp ||
      (app as App & { isMobile?: boolean }).isMobile === true;
    const getRegex = () => this.getRegex();
    const hideTimeStamp = (text: string) => this.hideTimeStamp(text);
    const isEnabled = () => this.settingsData.enabled;
    let pointerIsDown = false;
    let pointerDownSelection: EditorSelection | null = null;

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

        if (isMobileApp) {
          span.addEventListener("click", (event: MouseEvent) => {
            openTarget(event);
          });
          return span;
        }

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

          const selection = pointerIsDown && pointerDownSelection
            ? pointerDownSelection
            : view.state.selection;

          if (selectionTouchesRange(selection, linkStart, linkEnd)) {
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
          pointerdown: (_event, view) => {
            pointerDownSelection = view.state.selection;
            pointerIsDown = true;
          },
          pointerup: (_event, view) => {
            pointerIsDown = false;
            pointerDownSelection = null;
            view.plugin(livePreviewPlugin)?.rebuild(view);
          },
          pointercancel: (_event, view) => {
            pointerIsDown = false;
            pointerDownSelection = null;
            view.plugin(livePreviewPlugin)?.rebuild(view);
          }
        }
      }
    );

    return livePreviewPlugin;
  }
}

function selectionTouchesRange(selection: EditorSelection, from: number, to: number) {
  return selection.ranges.some((range) => {
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

    new Setting(containerEl).setName("Display").setHeading();

    new Setting(containerEl)
      .setName("Hide timestamp")
      .setDesc("Hide matching timestamp prefixes in rendered internal link text.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settingsData.enabled)
          .onChange(async (value) => {
            this.plugin.settingsData.enabled = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Hide timestamp in tab titles")
      .setDesc("Hide matching timestamp prefixes in workspace tab titles.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settingsData.hideTabTitles)
          .onChange(async (value) => {
            this.plugin.settingsData.hideTabTitles = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Hide timestamp in inline titles")
      .setDesc("Hide matching timestamp prefixes in titles shown inside notes.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settingsData.hideInlineTitles)
          .onChange(async (value) => {
            this.plugin.settingsData.hideInlineTitles = value;
            await this.plugin.saveSettings();
          });
      });

    const patternSetting = new Setting(containerEl)
      .setName("Timestamp regular expression")
      .setDesc("Default: ^\\d{10}\\s+")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.pattern)
          .setValue(this.plugin.settingsData.pattern)
          .onChange(async (value) => {
            const nextPattern = value.trim() || DEFAULT_SETTINGS.pattern;
            const error = validatePattern(nextPattern);

            if (error) {
              patternSetting.setDesc(`Invalid regular expression: ${error}`);
              return;
            }

            patternSetting.setDesc("Default: ^\\d{10}\\s+");
            this.plugin.settingsData.pattern = nextPattern;
            await this.plugin.saveSettings();
          });
      });
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
