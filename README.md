# Time Stamp Hider

Time Stamp Hider is an Obsidian plugin that hides timestamp prefixes in Zettelkasten-style internal link display text.

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

- **Hide timestamp**: Enable or disable display hiding.
- **Timestamp regular expression**: Customize the prefix pattern. Invalid regular expressions are ignored and shown in the settings UI.

## Installation

Once available in the Obsidian community plugin directory:

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

## License

MIT
