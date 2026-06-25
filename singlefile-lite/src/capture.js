(async () => {
  const DEFAULT_OPTIONS = {
    includeFrames: true,
    inlineImages: true,
    inlineStyles: true,
    removeScripts: true,
    includeMetadata: true,
    filenameTemplate: "{title}-{date}.html",
    autoSave: false
  };

  try {
    const options = await chrome.storage.sync.get(DEFAULT_OPTIONS);
    const captureMode = globalThis.__PAGEVAULT_CAPTURE_MODE || "page";
    globalThis.__PAGEVAULT_CAPTURE_MODE = "page";
    const archiver = new PageArchiver(document, { ...options, captureMode });
    const page = await archiver.createArchive();

    return {
      ok: true,
      html: page.html,
      filename: page.filename,
      bytes: page.html.length,
      title: document.title,
      url: location.href,
      mode: captureMode
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }

  function PageArchiver(sourceDocument, options) {
    this.doc = sourceDocument;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.baseUrl = sourceDocument.location?.href || location.href;
    this.cache = new Map();
  }

  PageArchiver.prototype.createArchive = async function () {
    await this.waitForFonts();
    if (!this.doc.documentElement) {
      throw new Error("This page cannot be saved because it has no document element.");
    }

    const clone = this.doc.documentElement.cloneNode(true);
    this.prepareClone(clone);
    if (this.options.captureMode === "selection") {
      this.keepSelectionOnly(clone);
    }
    if (this.options.removeScripts) {
      clone.querySelectorAll("script, noscript").forEach(node => node.remove());
    }
    if (this.options.inlineStyles) {
      await this.inlineStyles(clone);
      await this.inlineStyleAttributes(clone);
    }
    if (this.options.inlineImages) {
      await this.inlineMedia(clone);
    }
    if (this.options.includeFrames && this.options.captureMode !== "selection") {
      await this.inlineFrames(clone);
    }
    if (this.options.includeMetadata) {
      this.addMetadata(clone);
    }

    const html = `${serializeDoctype(this.doc)}\n${clone.outerHTML}`;
    return {
      html,
      filename: buildFilename({
        title: this.options.captureMode === "selection" ? `${this.doc.title || "page"} selection` : this.doc.title,
        url: this.baseUrl
      }, this.options.filenameTemplate)
    };
  };

  PageArchiver.prototype.waitForFonts = async function () {
    if (this.doc.fonts?.ready) {
      await Promise.race([this.doc.fonts.ready, delay(1500)]);
    }
  };

  PageArchiver.prototype.prepareClone = function (clone) {
    clone.querySelectorAll("base").forEach(node => node.remove());
    let head = clone.querySelector("head");
    if (!head) {
      head = this.doc.createElement("head");
      clone.prepend(head);
    }

    const charset = this.doc.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    head.prepend(charset);

    const base = this.doc.createElement("base");
    base.href = this.baseUrl;
    head.prepend(base);
  };

  PageArchiver.prototype.keepSelectionOnly = function (clone) {
    const selection = this.doc.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.toString().trim() === "") {
      throw new Error("Select some page content first, then try again.");
    }

    let body = clone.querySelector("body");
    if (!body) {
      body = this.doc.createElement("body");
      clone.append(body);
    }
    body.replaceChildren();

    const wrapper = this.doc.createElement("main");
    wrapper.setAttribute("data-pagevault-selection", "true");
    wrapper.style.maxWidth = "960px";
    wrapper.style.margin = "24px auto";
    wrapper.style.padding = "0 16px";

    for (let index = 0; index < selection.rangeCount; index += 1) {
      wrapper.append(selection.getRangeAt(index).cloneContents());
    }
    body.append(wrapper);
  };

  PageArchiver.prototype.inlineStyles = async function (clone) {
    const originalStyles = [...this.doc.querySelectorAll("style")];
    const clonedStyles = [...clone.querySelectorAll("style")];
    await Promise.all(clonedStyles.map(async (node, index) => {
      const css = originalStyles[index]?.textContent || node.textContent || "";
      node.textContent = await this.inlineCssUrls(css, this.baseUrl);
    }));

    const originalLinks = [...this.doc.querySelectorAll('link[rel~="stylesheet"][href]')];
    const clonedLinks = [...clone.querySelectorAll('link[rel~="stylesheet"][href]')];
    await Promise.all(clonedLinks.map(async (node, index) => {
      const href = absoluteUrl(originalLinks[index]?.href || node.getAttribute("href"), this.baseUrl);
      const css = await this.readStylesheet(originalLinks[index], href);
      if (!css) {
        return;
      }
      const style = this.doc.createElement("style");
      ["media", "title"].forEach(attr => {
        if (node.hasAttribute(attr)) {
          style.setAttribute(attr, node.getAttribute(attr) || "");
        }
      });
      style.textContent = await this.inlineCssUrls(css, href);
      node.replaceWith(style);
    }));
  };

  PageArchiver.prototype.inlineStyleAttributes = async function (clone) {
    await Promise.all([...clone.querySelectorAll("[style]")].map(async node => {
      node.setAttribute("style", await this.inlineCssUrls(node.getAttribute("style") || "", this.baseUrl));
    }));
  };

  PageArchiver.prototype.readStylesheet = async function (node, href) {
    if (node?.sheet) {
      try {
        return [...node.sheet.cssRules].map(rule => rule.cssText).join("\n");
      } catch {
        // Cross-origin stylesheets are attempted through fetch below.
      }
    }
    return this.fetchText(href);
  };

  PageArchiver.prototype.inlineMedia = async function (clone) {
    const tasks = [];
    clone.querySelectorAll("img[src], input[type=image][src], audio[src], video[src], source[src]").forEach(node => {
      tasks.push(this.inlineAttribute(node, "src"));
    });
    clone.querySelectorAll("img[srcset], source[srcset]").forEach(node => {
      tasks.push(this.inlineSrcset(node));
    });
    clone.querySelectorAll("video[poster]").forEach(node => {
      tasks.push(this.inlineAttribute(node, "poster"));
    });

    const originalCanvases = [...this.doc.querySelectorAll("canvas")];
    clone.querySelectorAll("canvas").forEach((node, index) => {
      try {
        const original = originalCanvases[index];
        if (!original) {
          return;
        }
        const image = this.doc.createElement("img");
        image.src = original.toDataURL("image/png");
        image.width = original.width;
        image.height = original.height;
        image.alt = "Saved canvas snapshot";
        node.replaceWith(image);
      } catch {
        node.setAttribute("data-pagevault-warning", "Canvas pixels could not be saved.");
      }
    });
    await Promise.all(tasks);
  };

  PageArchiver.prototype.inlineFrames = async function (clone) {
    const originalFrames = [...this.doc.querySelectorAll("iframe, frame")];
    const clonedFrames = [...clone.querySelectorAll("iframe, frame")];
    await Promise.all(clonedFrames.map(async (node, index) => {
      try {
        const frameDocument = originalFrames[index]?.contentDocument;
        if (!frameDocument?.documentElement) {
          return;
        }
        const frameArchiver = new PageArchiver(frameDocument, this.options);
        const framePage = await frameArchiver.createArchive();
        node.removeAttribute("src");
        node.setAttribute("srcdoc", framePage.html);
      } catch {
        node.setAttribute("data-pagevault-warning", "Cross-origin frame could not be embedded.");
      }
    }));
  };

  PageArchiver.prototype.inlineAttribute = async function (node, attr) {
    const value = node.getAttribute(attr);
    if (!value || shouldSkipUrl(value)) {
      return;
    }
    const dataUrl = await this.fetchDataUrl(absoluteUrl(value, this.baseUrl));
    if (dataUrl) {
      node.setAttribute(attr, dataUrl);
    }
  };

  PageArchiver.prototype.inlineSrcset = async function (node) {
    const srcset = node.getAttribute("srcset");
    if (!srcset) {
      return;
    }
    const entries = await Promise.all(parseSrcset(srcset).map(async entry => {
      if (shouldSkipUrl(entry.url)) {
        return entry.raw;
      }
      const dataUrl = await this.fetchDataUrl(absoluteUrl(entry.url, this.baseUrl));
      return dataUrl ? `${dataUrl}${entry.descriptor ? ` ${entry.descriptor}` : ""}` : entry.raw;
    }));
    node.setAttribute("srcset", entries.join(", "));
  };

  PageArchiver.prototype.inlineCssUrls = async function (css, baseUrl) {
    let output = css;
    const matches = [...css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
    for (const match of matches) {
      const rawUrl = match[2];
      if (!rawUrl || shouldSkipUrl(rawUrl)) {
        continue;
      }
      const dataUrl = await this.fetchDataUrl(absoluteUrl(rawUrl, baseUrl));
      if (dataUrl) {
        output = output.replace(match[0], `url("${dataUrl}")`);
      }
    }
    return output;
  };

  PageArchiver.prototype.fetchText = async function (url) {
    if (!url) {
      return "";
    }
    const cacheKey = `text:${url}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    try {
      const response = await fetch(url, { credentials: "include", cache: "force-cache" });
      const text = response.ok ? await response.text() : "";
      this.cache.set(cacheKey, text);
      return text;
    } catch {
      this.cache.set(cacheKey, "");
      return "";
    }
  };

  PageArchiver.prototype.fetchDataUrl = async function (url) {
    if (!url) {
      return "";
    }
    const cacheKey = `data:${url}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    try {
      const response = await fetch(url, { credentials: "include", cache: "force-cache" });
      const dataUrl = response.ok ? await blobToDataUrl(await response.blob()) : "";
      this.cache.set(cacheKey, dataUrl);
      return dataUrl;
    } catch {
      this.cache.set(cacheKey, "");
      return "";
    }
  };

  PageArchiver.prototype.addMetadata = function (clone) {
    let head = clone.querySelector("head");
    if (!head) {
      head = this.doc.createElement("head");
      clone.prepend(head);
    }
    const meta = this.doc.createElement("meta");
    meta.name = "generator";
    meta.content = `PageVault Single File 0.3.0; saved ${new Date().toISOString()} from ${this.baseUrl}`;
    head.append(meta);
  };

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function buildFilename(page, template) {
    const now = new Date();
    const values = {
      title: page.title || "page",
      host: safeHost(page.url),
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 8).replaceAll(":", "-")
    };
    const filename = String(template || "{title}-{date}.html")
      .replace(/\{(title|host|date|time)\}/g, (_, key) => values[key])
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    return filename.endsWith(".html") ? filename : `${filename || "page"}.html`;
  }

  function safeHost(url) {
    try {
      return new URL(url).host || "page";
    } catch {
      return "page";
    }
  }

  function absoluteUrl(value, base) {
    try {
      return new URL(value, base).href;
    } catch {
      return "";
    }
  }

  function shouldSkipUrl(value) {
    return /^(data:|blob:|about:|javascript:|mailto:|tel:|#)/i.test(value.trim());
  }

  function parseSrcset(srcset) {
    return srcset.split(",").map(part => {
      const raw = part.trim();
      const [url, ...descriptor] = raw.split(/\s+/);
      return { raw, url, descriptor: descriptor.join(" ") };
    }).filter(entry => entry.url);
  }

  function serializeDoctype(doc) {
    if (!doc.doctype) {
      return "<!doctype html>";
    }
    const publicId = doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : "";
    const systemId = doc.doctype.systemId ? `${publicId ? "" : " SYSTEM"} "${doc.doctype.systemId}"` : "";
    return `<!doctype ${doc.doctype.name}${publicId}${systemId}>`;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
