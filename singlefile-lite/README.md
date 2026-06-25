# PageVault Single File

PageVault is a clean-room Chrome MV3 extension that saves regular web pages as self-contained HTML files.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `singlefile-lite` folder.

## Use

- Click the extension popup and choose **Save current page**.
- Choose **Save selection** after selecting content on a page.
- Choose **Save all tabs** to archive every regular tab in the current window.
- Right-click a regular web page and choose **Save page as single HTML**.
- Right-click selected text/content and choose **Save selected content as single HTML**.
- Right-click a link and choose **Save linked page as single HTML**.
- Use `Ctrl+Shift+Y`.
- Turn on auto-save in the popup or options page to save pages after they finish loading.

## Supported

- Current tab capture.
- Selected content capture.
- Linked page capture through a temporary background tab.
- Save all tabs in the current window.
- Auto-save after page load.
- Inline reachable images, media, stylesheets, CSS images, and same-origin frames.
- Canvas snapshots when the browser allows reading canvas pixels.
- Configurable filename template.
- Script removal by default.

## Browser Limits

Chrome does not allow extensions to script protected pages such as `chrome://...`, DevTools pages, extension pages, or the Chrome Web Store. Test this extension on normal websites.
