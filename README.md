# Bulk File Renamer

Rename hundreds of files at once, right in your browser. You see every new name before anything changes, clashes are caught up front, and one click undoes the whole batch. Nothing is uploaded and there's nothing to install.

**Try it:** https://stravix86.github.io/bulk-file-renamer/ (Chrome or Edge on a computer)

**Windows app:** [BulkFileRenamer-windows.exe](https://github.com/Stravix86/bulk-file-renamer/releases/latest/download/BulkFileRenamer-windows.exe) (portable, about 3 MB, nothing to install). Windows may say "Windows protected your PC" because the exe isn't code-signed: click **More info → Run anyway**.

## The problem

Renaming a folder of photos, scans or downloads one file at a time is slow and error-prone. Built-in tools like Windows' "rename all" only give you `Name (1)`, `Name (2)`. Most bulk renamers are desktop apps you have to download and trust.

## Features

- **Pattern-based names.** Build names from tokens:
  | Token | Becomes |
  |---|---|
  | `{name}` | original name without extension |
  | `{n}` / `{n:3}` | counter, optionally zero-padded (`001`) |
  | `{date}` / `{date:YYYYMMDD_hhmmss}` | file's last-modified date |
  | `{parent}` | the folder's name |
  | `{ext}` | original extension |
- **Find and replace** inside names, with optional regex and match-case.
- **Letter case:** lowercase, UPPERCASE, Title Case, kebab-case, snake_case. Extensions can be lowercased or uppercased separately.
- **Sort order for numbering:** by name (natural order, so `IMG_2` comes before `IMG_10`), date modified or size.
- **Filter by type** (e.g. only `jpg, png`) and tick or untick individual files.
- **Presets:** *Photos by date*, *Folder name + number*, *Clean up names*.
- **Live preview** of every old → new name.
- **Safety checks before renaming:** duplicate names (case-insensitive, as on Windows and macOS), clashes with files you aren't renaming, characters Windows doesn't allow, reserved names like `CON`, and empty names. The Rename button stays off until all of them are fixed.
- **Safe two-step rename.** Every file goes to a temporary name first, so swaps (`a → b`, `b → a`) and case-only changes (`photo.JPG → photo.jpg`) just work. If a step fails, the file is put back.
- **Undo** the last batch with one click.

## How to use

1. Open the site in Chrome or Edge and click **Choose folder**. Allow edit access when the browser asks.
2. Pick a preset or type a pattern. Watch the preview update.
3. Click **Rename N files** and confirm.

## Run locally

It's plain HTML, CSS and JavaScript with no build step:

```bash
python -m http.server 8000
```

Then open http://localhost:8000. Folder access needs `localhost` or HTTPS.

## Building the Windows app

The exe is a small [Tauri](https://tauri.app) wrapper around these same web files, using Windows' built-in WebView2. Push a version tag (for example `git tag v1.0.1` then `git push origin v1.0.1`) and GitHub Actions builds it and attaches it to a Release. To build it yourself you need Rust, Node and the Visual Studio C++ build tools: run `node native/stage-web.mjs`, then `npx @tauri-apps/cli@2 build --no-bundle` inside `native/desktop`.

## Files

- `renamer.js` handles the naming logic and the safe rename (no DOM, so it's easy to test).
- `app.js` is the UI.
- `index.html` and `style.css` are the page and its styles.

## Browser support

Uses the [File System Access API](https://developer.mozilla.org/docs/Web/API/Window/showDirectoryPicker), available in Chrome, Edge and other Chromium browsers on desktop. Firefox and Safari don't support opening folders yet; the page tells you so.
