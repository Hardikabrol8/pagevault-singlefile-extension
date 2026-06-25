# PageVault Single File Extension

PageVault is a clean-room Chrome Manifest V3 extension for saving regular web pages as self-contained HTML files. It is inspired by the main workflow of SingleFile, but this repository is an independent implementation.

## What It Does

PageVault captures a page, serializes the DOM, inlines reachable page assets, and downloads one `.html` file through Chrome's downloads API.

Supported workflows:

- Save the current page.
- Save selected page content.
- Save a linked page from the right-click menu.
- Save all regular tabs in the current window.
- Auto-save pages after they finish loading.
- Use the keyboard shortcut `Ctrl+Shift+Y`.
- Configure filename and capture options from the options page.
- Trigger lazy-loaded content before capture.
- Preserve filled form values.
- Serialize open shadow roots when pages use web components.
- Optionally add a saved-page information banner.
- Optionally remove hidden elements from the archive.

## Install In Chrome

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository root folder, the folder that contains `manifest.json`.

After loading, pin the extension if you want quick access from the toolbar.

## How To Use

Use the popup:

- **Save current page** saves the active tab.
- **Save selection** saves highlighted content from the active tab.
- **Save all tabs** saves every regular tab in the current Chrome window.
- **Auto-save after page load** toggles automatic saving when pages finish loading.
- **Options** opens the settings page.

Use the context menu:

- Right-click a page and choose **Save page as single HTML**.
- Select text/content, right-click, and choose **Save selected content as single HTML**.
- Right-click a link and choose **Save linked page as single HTML**.

Saved files appear in Chrome's downloads list at `chrome://downloads`.

## Options

The options page lets you control:

- Include same-origin frames.
- Inline images and media.
- Inline stylesheets and CSS assets.
- Remove scripts from saved pages.
- Add preservation metadata.
- Auto-save pages after load.
- Scroll the page before capture to wake lazy-loaded content.
- Preserve current form field values.
- Serialize open shadow roots.
- Add a visible saved-page info banner.
- Remove hidden elements.
- Filename template.

Filename template tokens:

- `{title}` page title.
- `{host}` page host.
- `{date}` current date.
- `{time}` current time.

Example:

```text
{title}-{date}.html
```

## How It Works

The extension has three main parts:

- `manifest.json` declares the Chrome extension, permissions, popup, background worker, options page, and shortcut.
- `src/background.js` coordinates user actions, context menus, tab handling, protected-page checks, and file downloads.
- `src/capture.js` runs inside the active page and creates the single-file HTML archive.

Capture flow:

1. The user starts a save from the popup, context menu, shortcut, auto-save, or all-tabs action.
2. The background worker checks whether Chrome allows scripting that tab.
3. The background worker injects `src/capture.js`.
4. If enabled, the capture script scrolls the page to trigger lazy-loaded content.
5. The capture script clones the page DOM.
6. It preserves form values and serializes open shadow roots when enabled.
7. It removes scripts and hidden elements when those options are enabled.
8. It inlines reachable CSS, CSS `url(...)` assets, images, media, canvas snapshots, and same-origin frames.
9. It adds metadata and an optional saved-page info banner.
10. It returns the generated HTML to the background worker.
11. The background worker downloads the archive using `chrome.downloads.download`.

## Project Structure

```text
.
├── manifest.json
├── README.md
└── src
    ├── background.js
    ├── capture.js
    ├── options.css
    ├── options.html
    ├── options.js
    ├── popup.css
    ├── popup.html
    └── popup.js
```

## Browser Limits

Chrome does not allow extensions to script protected pages, including:

- `chrome://...`
- Chrome Web Store pages
- extension pages
- DevTools pages
- some browser-managed internal pages

Some resources may also remain remote if the browser blocks access because of cross-origin restrictions, page security policy, or tainted canvas content.

## Status

This is a working educational/browser-extension project, not a full replacement for the original SingleFile extension. Full SingleFile parity would require many more advanced capture, upload, annotation, profile, and automation features.
