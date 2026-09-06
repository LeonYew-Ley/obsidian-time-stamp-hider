import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright";

// Exercise the production extension with real CodeMirror views and mouse input.
// Obsidian's table rendering is represented by a widget with a nested editor.
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `
      import TimeStampHider from "./main.ts";
      import { EditorState, StateField } from "@codemirror/state";
      import { EditorView, Decoration, WidgetType } from "@codemirror/view";
      import { editorLivePreviewField } from "obsidian";
      Object.defineProperty(HTMLElement.prototype, "win", { get() { return this.ownerDocument.defaultView; } });
      let outer, inner, plugin, updates;
      window.mount = (kind = "table", enabled = true, livePreview = true) => {
        outer?.destroy();
        document.body.replaceChildren();
        updates = [];
        plugin = new TimeStampHider();
        plugin.settingsData = { enabled, pattern: "^\\\\d{10}\\\\s+" };
        const extensions = () => [
          editorLivePreviewField.init(() => livePreview),
          plugin.createLivePreviewExtension(),
          EditorView.theme({ "&": { fontSize: "18px" }, ".cm-content": { minHeight: "40px" } })
        ];
        class CellWidget extends WidgetType {
          toDOM() {
            const host = document.createElement("div");
            let cell = host;
            if (kind === "table") {
              host.className = "cm-embed-block cm-table-widget";
              const table = host.appendChild(document.createElement("table"));
              cell = table.insertRow().insertCell();
            }
            if (kind === "control") {
              cell = host.appendChild(document.createElement("button"));
              cell.textContent = "Action";
            } else {
              inner = new EditorView({ doc: "动作备注：缓慢抬起手臂", parent: cell, extensions: extensions() });
            }
            return host;
          }
          destroy() { inner?.destroy(); inner = null; }
        }
        const doc = "[[2609062246 Training]] ordinary text\\n\\nTABLE";
        const widget = StateField.define({
          create: () => Decoration.set([Decoration.replace({widget: new CellWidget(), block:true}).range(doc.indexOf("TABLE"),doc.length)]),
          update: value => value,
          provide: field => EditorView.decorations.from(field)
        });
        outer = new EditorView({
          parent: document.body,
          state: EditorState.create({doc, extensions: [...extensions(), widget,
            EditorView.updateListener.of(u => updates.push(...u.transactions.map(t => ({selection:!!t.selection, effects:t.effects.length}))))
          ]})
        });
      };
      window.snapshot = () => ({
        updates: updates.length,
        outer: outer.state.selection.main.toJSON(),
        inner: inner?.state.selection.main.toJSON(),
        selectedText: inner ? inner.state.sliceDoc(inner.state.selection.main.from,inner.state.selection.main.to) : "",
        marks: outer.contentDOM.querySelectorAll(".tsh-hide-timestamp").length
      });
      window.point = (which, pos) => {
        const r = (which === "inner" ? inner : outer).coordsAtPos(pos);
        return {x:r.left, y:(r.top+r.bottom)/2};
      };
      window.dispose = () => outer?.destroy();
    `
  },
  bundle: true,
  write: false,
  format: "iife",
  plugins: [{
    name: "obsidian-test-api",
    setup(b) {
      // Optional proof that the same test fails against an earlier revision.
      if (process.env.TSH_BASELINE_REF) {
        b.onLoad({ filter: /[\\/]main\.ts$/ }, () => ({
          contents: execFileSync("git", ["show", `${process.env.TSH_BASELINE_REF}:main.ts`], {encoding: "utf8"}),
          loader: "ts",
          resolveDir: process.cwd()
        }));
      }
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        resolveDir: process.cwd(),
        contents: `import {StateField} from "@codemirror/state";
          export const editorLivePreviewField = StateField.define({create:()=>true,update:v=>v});
          export class Plugin {} export class PluginSettingTab {} export class Setting {}
          export const getLanguage = () => "en";`
      }));
    }
  }]
});

let browser;
for (const options of [{channel: "chrome"}, {channel: "msedge"}, {}]) {
  try { browser = await chromium.launch({headless: true, ...options}); break; }
  catch (error) { if (!Object.keys(options).length) throw error; }
}
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setContent("<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>");
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  const snapshot = () => page.evaluate(() => window.snapshot());
  const mount = async (...args) => {
    await page.evaluate(args => window.mount(...args), args);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const point = (which, pos) => page.evaluate(([which,pos]) => window.point(which,pos), [which,pos]);

  for (const kind of ["table", "nested"]) {
    await mount(kind);
    const start = await point("inner", 0), end = await point("inner", 4);
    const baseline = (await snapshot()).updates;
    await page.mouse.move(start.x,start.y);
    await page.mouse.down();
    assert.equal((await snapshot()).updates, baseline, `${kind}: outer editor must not lock on mousedown`);
    await page.mouse.move(end.x,end.y,{steps:8});
    await page.mouse.up();
    const result = await snapshot();
    assert.equal(result.selectedText,"动作备注",`${kind}: cell text can be selected`);
    assert.equal(result.updates,baseline,`${kind}: outer editor must not dispatch on mouseup`);
    console.log(`PASS ${kind}: nested selection and outer editor isolation`);
  }

  await mount("control");
  const beforeControl = (await snapshot()).updates;
  await page.getByRole("button").click();
  assert.equal((await snapshot()).updates,beforeControl,"widget controls must not lock the editor");
  console.log("PASS widget control isolation");

  await mount();
  assert.equal((await snapshot()).marks,1,"timestamp mark remains present");
  const text = await point("outer",28);
  await page.mouse.move(text.x,text.y);
  await page.mouse.down();
  assert.equal((await snapshot()).outer.anchor,0,"ordinary click is deferred until release");
  await page.mouse.up();
  assert.ok((await snapshot()).outer.anchor>0,"ordinary click commits on release");
  console.log("PASS ordinary click deferral and timestamp decoration");

  await mount();
  const dragStart = await point("outer",25), dragEnd = await point("outer",32);
  await page.mouse.move(dragStart.x,dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x,dragEnd.y,{steps:8});
  const duringDrag = (await snapshot()).outer;
  assert.notEqual(duringDrag.anchor,duringDrag.head,"drag must select before mouseup");
  await page.mouse.up();
  console.log("PASS live ordinary-text drag selection");

  for (const event of ["blur","pointercancel"]) {
    await mount();
    const p = await point("outer",28);
    await page.mouse.move(p.x,p.y);
    await page.mouse.down();
    await page.evaluate(type => window.dispatchEvent(new Event(type)),event);
    await page.mouse.up();
    assert.equal((await snapshot()).outer.anchor,0,`${event}: discard deferred selection`);
    await page.mouse.click(p.x,p.y);
    assert.ok((await snapshot()).outer.anchor>0,`${event}: next click still works`);
    console.log(`PASS ${event} lock cleanup`);
  }

  for (const [enabled,livePreview] of [[false,true],[true,false]]) {
    await mount("table",enabled,livePreview);
    const p = await point("outer",28);
    await page.mouse.move(p.x,p.y);
    await page.mouse.down();
    assert.ok((await snapshot()).outer.anchor>0,"disabled/source mode must select immediately");
    await page.mouse.up();
    console.log(`PASS enabled=${enabled}, livePreview=${livePreview}`);
  }
  await page.evaluate(() => window.dispose());
  assert.deepEqual(errors,[],"no browser runtime errors");
} finally {
  await browser.close();
}
