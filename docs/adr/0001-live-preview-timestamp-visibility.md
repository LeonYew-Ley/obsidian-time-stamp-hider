# ADR 0001: Live Preview 时间戳显隐与页签打开空白行

- 状态：Accepted（已由实际 Obsidian 交互验证）
- 日期：2026-08-31
- 决策人：LeonYew
- 相关代码：`main.ts`（`createLivePreviewExtension`）
- 复现笔记：`01_FleetingNotes/2607220941 蛇蛇 MVP 2.0 前的项目工程化.md` 第一行 `[[2607011131 蛇蛇开发日报]]`

## 背景

Live Preview 里要在不改源码的前提下，把 Zettelkasten 双链文件名开头的时间戳藏掉。旧实现用 `Decoration.replace` 把整段 `[[时间戳 标题]]` 换成自定义 widget。

用户报告：切换或打开页签后，已经处理过的时间戳链接会整段看不见；把光标移过去，或上下滚动，才会重新出现。

## 目前的根因判断（未完全确认）

下面是当前最能对上现象的解释，**还不是定论**。库内试用几天后再决定是否升为 Accepted，或改写本 ADR。

### 现象 A：打开页签后第一行空白

已稳定打中一次，并被监视探针记为「视口内找不到标题「蛇蛇开发日报」」。

该笔记第一行**整行只有**一条无 alias 双链。`Decoration.replace` 会把这一行的全部文档文字换成 widget。打开页签时 widget 有时没画进 DOM（探针里 `hiddenWidgets` 为空、`missingTitles` 命中）。滚动触发 `viewportChanged`，或光标进入该行，装饰重建后标题才出现。

纯 CodeMirror 里用 `display: none` 模拟切页签无法复现；程序化 `openLinkText` / 点页签也经常 0 命中。更像是 **Obsidian 页签显隐 + 整行 replace widget** 的竞态，而不是单纯的 CSS `color: transparent`。

仍不确定的点：

- 是否只有「整行都是双链」才会空，还是其它行的 widget 也会偶发不绘制。
- 空白是 widget 未挂上，还是挂上了但尺寸为 0 / 被别的装饰盖住。冻结现场时用户没有做 DevTools 节点检查。

### 现象 B：鼠标聚焦时时间戳和括号分两步出现

改成只 mark 时间戳之后出现。键盘移光标正常；鼠标按下时先露出时间戳，松开才露出完整 `[[...]]`。

当前判断：Obsidian / CodeMirror 在 **mousedown** 就提交指针选区，核心 Live Preview 据此展开或收起源码。插件若再用自己的 pointer 锁、line decoration 或后续 microtask 单独控制时间戳，就形成两套不同步的状态机，无法保证时间戳与 `[[` `]]` 在同一次视图更新里变化。

曾试过在按下期间用 `FrozenSourceWidget` 把旧行的 `[[...]]` 画回来。这只能得到一个继承普通文字颜色的纯文本 `<span>`，不是 Obsidian 原生的源码 token DOM，所以失焦链接会变白；同时它又重新引入了整段 `Decoration.replace`，与决策 1 冲突。

## 决策

### 1. 不再用整段 replace widget

Live Preview 只对文件名里的时间戳前缀加 `Decoration.mark`（`.tsh-hide-timestamp`），标题和 `[[` `]]` 留在原文里。

理由：整行被掏空后，widget 一旦没画出来，这一行就没有任何真实文字可回退。mark 不会把行变成空行，也避免和 Obsidian 自己的链接 replace 叠在同一段范围上。

阅读模式仍用 post processor 改 `a.internal-link` 的 `textContent`，与本决策无关。

### 2. 时间戳显隐跟原生括号 DOM 走，不跟选区或 `.cm-active`

mark **一直挂着**，不在选区碰到双链时拆掉。`.cm-active`、selection 和 pointer 事件都只是 Obsidian 核心源码渲染的上游信号；核心 wikilink view decoration 可能在稍后的视图更新里才生成或移除 `[[` `]]`，用这些信号提前切换时间戳仍会产生中间帧。

用 `EditorView.baseTheme`：

- 默认：时间戳 `font-size: 0`、`color: transparent`
- 当前 `.cm-line` 实际含有 Obsidian 原生 `.cm-formatting-link` 括号节点时：恢复 `inherit`

CSS 通过 `.cm-line:has(.cm-formatting-link)` 直接跟随核心 DOM。括号节点出现或消失的同一次浏览器样式计算里，时间戳一起显示或隐藏；插件不再维护 `.tsh-source-open` line decoration，也不再用第二个 CodeMirror transaction 猜测核心何时渲染完成。

### 3. 鼠标按下期间冻结实际选区，而不是伪造源码外观

theme **完全不看 `.cm-active`**。插件不再在 Obsidian 改完选区之后补画旧状态，而是在主键 `mousedown` 时同步进入每个编辑器自己的选区锁：

- CodeMirror 仍负责计算单击、拖选、Shift 扩选和多选的目标选区。
- 普通点击按住期间只拦截 selection-only 的 `select.pointer` 事务，把最新的 `EditorSelection` 缓存在 `StateField`，实际 editor selection 保持不变。
- 因为真实选区没变，旧行仍由 Obsidian 原生 Live Preview 保持源码态；新行也不会提前展开，期间不需要 `.cm-active` 伪装或源码 widget。
- 鼠标移动超过拖拽阈值时立即提交缓存并解锁；后续 `mousemove` 继续走 CodeMirror 原生选区，用户能实时看到拖选高亮。
- 没有形成拖拽时，`mouseup` 后把缓存选区与“解除锁定”放进同一个事务。时间戳不直接跟这个事务切换，而是等待核心括号 DOM 真正变化。
- `pointercancel` 或窗口失焦时放弃缓存选区并解锁，避免编辑器卡在冻结状态。

窗口级监听只接管当前 `EditorView.contentDOM` 的直属 `.cm-line` 文本。事件目标最近的 `.cm-content` 必须是当前编辑器，并且不能位于表格、嵌入块、`contenteditable="false"` 区域或表单控件中。单纯的 `contains()` 会把表格内嵌编辑器也算作外层编辑器，不能用来判断事件归属。

预期交互：

1. 按下：聚焦行和失焦行都不变（包括双括号）。
2. 松开：所有选中行一次出现完整源码；未选中行一次回到隐藏时间戳的预览。

## 后果

- 同一行有多条双链时，只要 Obsidian 在该行渲染了原生源码括号，该行的时间戳会一起恢复；多行拖选仍由核心实际渲染结果决定。
- Live Preview 不再创建任何自定义链接或源码 widget；语法颜色、点击打开和点进编辑全部交给 Obsidian 原生实现。
- `Ctrl`/`Cmd` + 点击打开链接仍走 Obsidian 默认行为。
- 若观察后发现空白行仍出现，应优先怀疑 mark 与 HyperMD 装饰的其它冲突，而不是先回到整段 replace。

## 后续观察

试用几天后对照本 ADR 核对：

- [x] 再打开「第一行整行是时间戳双链」的笔记，第一行是否还会空白。
- [x] 鼠标按下是否完全无变化，松开是否一次出现完整源码。
- [x] 失焦是否一次回到隐藏时间戳，中间不闪时间戳或括号。
- [ ] 空白是否出现在「行内还有其它文字」的双链上（若会，则「整行 replace」解释不完整）。

上述交互已通过手动验证，因此本决策升为 **Accepted**。
若仍复现，把新证据补进「根因判断」，并改决策，不要只改代码不改本文件。


## 2026-09-06：表格内文字无法拖选的修复

用户在「肩关节灵活度训练方案」的「动作备注」单元格中无法选择文字，关闭插件后恢复正常。

实际 DOM 中，`table.table-editor` 位于外层 `.cm-content` 下的 `.cm-table-widget.cm-embed-block[contenteditable="false"]` 内，编辑单元格时还会创建自己的 `.cm-editor`。原来的 `contentDOM.contains(event.target)` 把这些点击也纳入了正文选区锁；外层编辑器的锁定、解锁事务因而干扰了单元格编辑。

通过 Obsidian CLI/CDP 在原笔记上执行相同的按下、拖动、松开动作：

- 修复前：在单元格内按下时外层 `locked=true`；拖选后 DOM 文字选区为空。
- 修复后：外层 `locked=false`；拖选得到完整「动作备注」，焦点仍在表格中。

决策 3 的范围收窄为普通正文行，表格（包括其内部编辑器）和其它交互组件自行处理选区；时间戳 mark、原生括号 CSS 同步及正文拖选阈值保持原设计。

新增 `npm run test:pointer`，使用生产扩展、真实 CodeMirror、表格 widget 和嵌套编辑器运行浏览器回归测试，覆盖表格拖选、外层编辑器隔离、正文按下/松开、实时拖选、取消/失焦和禁用/源码模式。相同测试在修复前的 Git 版本上失败，在修复后通过。浏览器模型不模拟全部 Obsidian 表格实现，因此原笔记的实际验证仍是必要补充。
