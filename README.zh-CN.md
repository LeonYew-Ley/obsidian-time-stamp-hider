# Time Stamp Hider

[English README](https://github.com/LeonYew-Ley/obsidian-time-stamp-hider/blob/main/README.md)

Time Stamp Hider 是一个 Obsidian 插件，用于在界面显示中隐藏 Zettelkasten 风格文件名开头的时间戳。

![Time Stamp Hider 演示](https://raw.githubusercontent.com/LeonYew-Ley/obsidian-time-stamp-hider/main/assets/demo.gif)

它适用于这样的笔记文件名：

```text
2603040057 Zettelkasten笔记法
2603162135 Obsidian 说明书
```

显示时可以变成：

```text
Zettelkasten笔记法
Obsidian 说明书
```

插件不会修改原始文件名，也不会修改 Markdown 内容。

## 功能

- 在 Reading View 中隐藏内部链接显示文本开头的时间戳。
- 在 Live Preview 可稳定处理的范围内隐藏内部链接显示文本开头的时间戳。
- 不修改 Markdown 源码、双链目标、alias、frontmatter、文件名、反向链接、重命名逻辑或 Obsidian 索引。
- 支持自定义正则表达式。
- 可在插件设置中启用或禁用。

## 默认匹配规则

默认正则表达式：

```regex
^\d{10}\s+
```

它会匹配文件名开头的 10 位数字时间戳和后面的空格。

例如：

```text
2603040057 Zettelkasten笔记法
```

显示为：

```text
Zettelkasten笔记法
```

## 插件不会做什么

Time Stamp Hider 只改变受支持渲染区域里的显示文本。

它不会：

- 重命名文件。
- 修改 Markdown 文件。
- 修改链接目标。
- 生成 alias。
- 读取或依赖 frontmatter title。
- 改变 Obsidian 的链接解析、重命名、反向链接、出链、搜索索引或图谱数据。
- 修改 Obsidian 内部的文件列表、搜索结果、反向链接、出链、快速切换或图谱视图 UI。

## Live Preview 行为

在 Live Preview 中，插件会尽量保持链接可编辑：

- 普通点击会显示原始 `[[...]]` 源码，方便编辑链接。
- 光标移动到链接内部或边界附近时，会显示原始源码。
- `Ctrl`/`Cmd` + 点击会打开链接目标。

## 设置

打开 **Settings → Community plugins → Time Stamp Hider**。

可用设置：

- **Hide timestamp**：启用或禁用隐藏时间戳。
- **Timestamp regular expression**：自定义时间戳前缀匹配规则。无效正则会在设置界面中提示，并被插件安全忽略。

## 安装

插件进入 Obsidian 社区插件目录后：

1. 打开 **Settings → Community plugins**。
2. 搜索 **Time Stamp Hider**。
3. 安装并启用插件。

## 手动安装

从最新 GitHub Release 下载文件，放到：

```text
<vault>/.obsidian/plugins/time-stamp-hider/
```

需要的文件：

- `main.js`
- `manifest.json`

然后重启 Obsidian，并在社区插件设置中启用插件。

## 开发

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

编译后的插件入口是 `main.js`。

## 许可证

MIT
