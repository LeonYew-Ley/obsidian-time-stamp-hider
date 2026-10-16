# Time Stamp Hider

[中文说明](https://github.com/LeonYew-Ley/obsidian-time-stamp-hider/blob/main/README.zh-CN.md)

[Install from Obsidian Community Plugins](https://community.obsidian.md/plugins/time-stamp-hider)

Time Stamp Hider is an Obsidian plugin that hides timestamp prefixes in Zettelkasten-style internal links and note titles.

## Demo

![Time Stamp Hider demo](https://raw.githubusercontent.com/LeonYew-Ley/obsidian-time-stamp-hider/main/assets/demo.gif)

It is designed for notes named like this:

```text
2603040057 Zettelkasten笔记法
2603162135 Obsidian 说明书
```

The links can be displayed like this:

```text
Zettelkasten笔记法
Obsidian 说明书
```

The original filenames and Markdown content are not changed.

## Features

- Hides timestamp prefixes in Reading View internal links.
- Hides timestamp prefixes in Live Preview internal links where stable editor rendering allows it.
- Optionally hides timestamp prefixes in native workspace tab titles and Vertical Tabs.
- Optionally hides timestamp prefixes in titles shown inside notes.
- Keeps Markdown source, wikilinks, aliases, frontmatter, filenames, backlinks, renaming, and Obsidian indexing untouched.
- Supports a custom regular expression for the prefix.
- Can be enabled or disabled from the plugin settings.

## Default Pattern

The default prefix pattern is:

```regex
^\d{10}\s+
```

This matches filenames that start with a 10-digit timestamp followed by one or more spaces.

For example:

```text
2603040057 Zettelkasten笔记法
```

is displayed as:

```text
Zettelkasten笔记法
```

## What This Plugin Does Not Do

Time Stamp Hider only changes display text in supported rendered editor surfaces.

It does not:

- Rename files.
- Modify Markdown files.
- Modify link targets.
- Generate aliases.
- Read or depend on frontmatter titles.
- Change Obsidian's link resolution, rename behavior, backlinks, outgoing links, search index, or graph data.
- Patch Obsidian's internal File Explorer, Search Results, Backlinks, Outgoing Links, Quick Switcher, or Graph View UI.

## Live Preview Behavior

In Live Preview, the plugin keeps links editable:

- Normal click reveals the original `[[...]]` source so you can edit the link.
- Moving the cursor into or next to the link reveals the original source.
- `Ctrl`/`Cmd` + click opens the linked note.

## Settings

Open **Settings → Community plugins → Time Stamp Hider**.

Available settings:

- **Hide timestamp**: Enable or disable hiding in rendered internal link text.
- **Hide timestamp in tab titles**: Hide the prefix in native workspace tabs and Vertical Tabs. This is off by default.
- **Hide timestamp in inline titles**: Hide the prefix in titles shown inside notes. This is off by default.
- **Timestamp regular expression**: Customize the prefix pattern. Invalid regular expressions are ignored and shown in the settings UI.

The settings interface follows Obsidian's current language. English and Simplified Chinese are currently supported; all other languages fall back to English.

## Installation

Install Time Stamp Hider from its [Obsidian Community Plugins page](https://community.obsidian.md/plugins/time-stamp-hider), or install it from inside Obsidian:

1. Open **Settings → Community plugins**.
2. Search for **Time Stamp Hider**.
3. Install and enable the plugin.

## Manual Installation

Download the latest release files and place them in:

```text
<vault>/.obsidian/plugins/time-stamp-hider/
```

Required files:

- `main.js`
- `manifest.json`

Then reload Obsidian and enable the plugin.

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

The compiled plugin entrypoint is `main.js`.

## Support

If this plugin helps you, you can support its development:

<a href="https://ko-fi.com/leonyew"><img alt="Ko-fi" src="https://img.shields.io/badge/Ko--fi-Support-FF5E5B?logo=ko-fi&logoColor=white"></a>
<a href="https://afdian.com/a/leonyew"><img alt="爱发电" src="https://img.shields.io/badge/%E7%88%B1%E5%8F%91%E7%94%B5-Afdian-946CE6"></a>

- [Ko-fi](https://ko-fi.com/leonyew) (international)
- [爱发电 Afdian](https://afdian.com/a/leonyew) (mainland China)

## License

MIT
