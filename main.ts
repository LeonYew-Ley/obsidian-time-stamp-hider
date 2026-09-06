import {
  App,
  MarkdownPostProcessorContext,
  Plugin,
  PluginSettingTab,
  Setting,
  editorLivePreviewField
} from "obsidian";
import {
  EditorSelection,
  EditorState,
  Extension,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin
} from "@codemirror/view";
import { getTranslator } from "./i18n";

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
const NATIVE_TAB_TITLE_SELECTOR = ".workspace-tab-header-inner-title";
const VERTICAL_TABS_TITLE_SELECTOR =
  ".obsidian-vertical-tabs-container .tree-item.is-tab .tree-item-inner-text";
const TAB_TITLE_SELECTOR =
  `${NATIVE_TAB_TITLE_SELECTOR}, ${VERTICAL_TABS_TITLE_SELECTOR}`;
const INLINE_TITLE_SELECTOR = ".inline-title";
const TITLE_SELECTOR = `${TAB_TITLE_SELECTOR}, ${INLINE_TITLE_SELECTOR}`;
const HIDDEN_TIMESTAMP_CLASS = "tsh-hide-timestamp";
const POINTER_DRAG_THRESHOLD = 4;
const setPointerSelectionLock = StateEffect.define<boolean>();
const rememberPendingPointerSelection = StateEffect.define<EditorSelection>({
  map: (selection, changes) => selection.map(changes)
});

interface PointerSelectionState {
  locked: boolean;
  pendingSelection: EditorSelection | null;
}

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
    const getRegex = () => this.getRegex();
    const isEnabled = () => this.settingsData.enabled;

    const hideTimestampMark = Decoration.mark({
      class: HIDDEN_TIMESTAMP_CLASS,
      attributes: { "aria-hidden": "true" }
    });

    const buildDecorations = (state: EditorState): DecorationSet => {
      const builder = new RangeSetBuilder<Decoration>();
      const regex = getRegex();

      if (!isEnabled() || !regex || !state.field(editorLivePreviewField, false)) {
        return builder.finish();
      }

      const text = state.doc.sliceString(0, state.doc.length);
      const pattern = new RegExp(WIKI_LINK_PATTERN.source, "g");

      for (const match of text.matchAll(pattern)) {
        const alias = match[2];
        if (alias || match.index === undefined) {
          continue;
        }

        const target = match[1];
        const fileName = target.split("/").pop() ?? target;
        const timestamp = fileName.match(regex)?.[0];
        if (!timestamp || timestamp.length >= fileName.length) {
          continue;
        }

        const linkStart = match.index;
        const nameStart = linkStart + 2 + (target.length - fileName.length);
        builder.add(nameStart, nameStart + timestamp.length, hideTimestampMark);
      }

      return builder.finish();
    };

    const decorationsField = StateField.define<DecorationSet>({
      create(state) {
        return buildDecorations(state);
      },
      update(decorations, tr) {
        const livePreviewChanged =
          tr.startState.field(editorLivePreviewField, false) !==
          tr.state.field(editorLivePreviewField, false);

        if (tr.docChanged || tr.reconfigured || livePreviewChanged) {
          return buildDecorations(tr.state);
        }

        return decorations.map(tr.changes);
      },
      provide: (field) => Prec.highest(EditorView.decorations.from(field))
    });

    const hideTimestampTheme = EditorView.baseTheme({
      [`.cm-line .${HIDDEN_TIMESTAMP_CLASS}`]: {
        fontSize: "0px",
        color: "transparent"
      },
      [`.cm-line:has(.cm-formatting-link) .${HIDDEN_TIMESTAMP_CLASS}`]: {
        fontSize: "inherit",
        color: "inherit"
      }
    });

    const pointerSelectionField = StateField.define<PointerSelectionState>({
      create() {
        return { locked: false, pendingSelection: null };
      },
      update(value, tr) {
        let locked = value.locked;
        let pendingSelection = tr.docChanged && value.pendingSelection
          ? value.pendingSelection.map(tr.changes)
          : value.pendingSelection;

        for (const effect of tr.effects) {
          if (effect.is(setPointerSelectionLock)) {
            locked = effect.value;
            pendingSelection = null;
          } else if (effect.is(rememberPendingPointerSelection)) {
            pendingSelection = effect.value;
          }
        }

        if (
          locked === value.locked &&
          pendingSelection === value.pendingSelection
        ) {
          return value;
        }

        return { locked, pendingSelection };
      }
    });

    const deferPointerSelection = Prec.highest(
      EditorState.transactionFilter.of((tr) => {
        const pointerState = tr.startState.field(pointerSelectionField, false);
        const unlocksPointerSelection = tr.effects.some((effect) =>
          effect.is(setPointerSelectionLock) && !effect.value
        );

        if (
          !pointerState?.locked ||
          unlocksPointerSelection ||
          !tr.selection ||
          !tr.isUserEvent("select.pointer") ||
          tr.docChanged ||
          tr.reconfigured
        ) {
          return tr;
        }

        return {
          effects: [
            ...tr.effects,
            rememberPendingPointerSelection.of(tr.newSelection)
          ],
          annotations: [
            Transaction.userEvent.of("select.pointer.deferred"),
            Transaction.addToHistory.of(false)
          ],
          filter: false
        };
      })
    );

    const pointerSelectionPlugin = ViewPlugin.fromClass(class {
      private pointerDownPosition: { x: number; y: number } | null = null;
      private readonly onMouseDown: (event: MouseEvent) => void;
      private readonly onMouseMove: (event: MouseEvent) => void;
      private readonly onMouseUp: () => void;
      private readonly onPointerCancel: () => void;
      private readonly onWindowBlur: () => void;

      constructor(private readonly view: EditorView) {
        this.onMouseDown = (event) => {
          if (
            event.button !== 0 ||
            !this.eventBelongsToEditor(event) ||
            !isEnabled() ||
            !this.view.state.field(editorLivePreviewField, false)
          ) {
            return;
          }

          const pointerState = this.view.state.field(pointerSelectionField);
          if (pointerState.locked) {
            return;
          }

          this.view.dispatch({
            effects: setPointerSelectionLock.of(true),
            annotations: Transaction.addToHistory.of(false)
          });
          this.pointerDownPosition = {
            x: event.clientX,
            y: event.clientY
          };
        };
        this.onMouseMove = (event) => {
          if (
            this.pointerDownPosition === null ||
            (event.buttons & 1) === 0
          ) {
            return;
          }

          const deltaX = event.clientX - this.pointerDownPosition.x;
          const deltaY = event.clientY - this.pointerDownPosition.y;
          if (Math.hypot(deltaX, deltaY) < POINTER_DRAG_THRESHOLD) {
            return;
          }

          this.pointerDownPosition = null;
          this.finishPointerSelection(true);
        };
        this.onMouseUp = () => {
          this.pointerDownPosition = null;
          queueMicrotask(() => this.finishPointerSelection(true));
        };
        this.onPointerCancel = () => {
          this.pointerDownPosition = null;
          this.finishPointerSelection(false);
        };
        this.onWindowBlur = () => {
          this.pointerDownPosition = null;
          this.finishPointerSelection(false);
        };

        const win = this.eventWindow();
        win.addEventListener("mousedown", this.onMouseDown, true);
        win.addEventListener("mousemove", this.onMouseMove, true);
        win.document.addEventListener("mouseup", this.onMouseUp, true);
        win.addEventListener("pointercancel", this.onPointerCancel, true);
        win.addEventListener("blur", this.onWindowBlur);
      }

      destroy() {
        this.pointerDownPosition = null;
        const win = this.eventWindow();
        win.removeEventListener("mousedown", this.onMouseDown, true);
        win.removeEventListener("mousemove", this.onMouseMove, true);
        win.document.removeEventListener("mouseup", this.onMouseUp, true);
        win.removeEventListener("pointercancel", this.onPointerCancel, true);
        win.removeEventListener("blur", this.onWindowBlur);
      }

      private eventWindow(): Window {
        return this.view.dom.win;
      }

      private eventBelongsToEditor(event: MouseEvent): boolean {
        const target = event.target as Node | null;
        const element = target?.nodeType === 1
          ? target as Element
          : target?.parentElement;

        // Table cells have their own editors. A containment check alone also
        // locks the outer editor, whose dispatch can reset the cell selection.
        if (
          !element ||
          element.closest(".cm-content") !== this.view.contentDOM ||
          element.closest(
            "table, .cm-table-widget, .cm-embed-block, " +
            "[contenteditable='false'], input, textarea, select, button"
          )
        ) {
          return false;
        }

        // Only native text lines participate in the delayed link reveal.
        const line = element.closest(".cm-line");
        return line !== null && line.parentElement === this.view.contentDOM;
      }

      private finishPointerSelection(commit: boolean) {
        if (!this.view.dom.isConnected) {
          return;
        }

        const pointerState = this.view.state.field(pointerSelectionField);
        if (!pointerState.locked) {
          return;
        }

        const pendingSelection = commit
          ? pointerState.pendingSelection
          : null;
        this.view.dispatch({
          selection: pendingSelection ?? this.view.state.selection,
          effects: setPointerSelectionLock.of(false),
          annotations: [
            Transaction.userEvent.of("select.pointer.commit"),
            Transaction.addToHistory.of(false)
          ],
          scrollIntoView: pendingSelection !== null
        });
      }
    });

    return [
      pointerSelectionField,
      deferPointerSelection,
      decorationsField,
      hideTimestampTheme,
      Prec.highest(pointerSelectionPlugin)
    ];
  }
}

class TimeStampHiderSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TimeStampHiderPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const t = getTranslator();

    containerEl.empty();

    new Setting(containerEl).setName(t("displayHeading")).setHeading();

    new Setting(containerEl)
      .setName(t("hideTimestampName"))
      .setDesc(t("hideTimestampDesc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settingsData.enabled)
          .onChange(async (value) => {
            this.plugin.settingsData.enabled = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("hideTabTitlesName"))
      .setDesc(t("hideTabTitlesDesc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settingsData.hideTabTitles)
          .onChange(async (value) => {
            this.plugin.settingsData.hideTabTitles = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("hideInlineTitlesName"))
      .setDesc(t("hideInlineTitlesDesc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settingsData.hideInlineTitles)
          .onChange(async (value) => {
            this.plugin.settingsData.hideInlineTitles = value;
            await this.plugin.saveSettings();
          });
      });

    const patternSetting = new Setting(containerEl)
      .setName(t("patternName"))
      .setDesc(t("patternDefault", { pattern: DEFAULT_SETTINGS.pattern }))
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.pattern)
          .setValue(this.plugin.settingsData.pattern)
          .onChange(async (value) => {
            const nextPattern = value.trim() || DEFAULT_SETTINGS.pattern;
            const error = validatePattern(nextPattern);

            if (error) {
              patternSetting.setDesc(t("patternInvalid", { error }));
              return;
            }

            patternSetting.setDesc(
              t("patternDefault", { pattern: DEFAULT_SETTINGS.pattern })
            );
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
