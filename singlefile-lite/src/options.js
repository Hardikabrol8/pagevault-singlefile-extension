const DEFAULT_OPTIONS = {
  includeFrames: true,
  inlineImages: true,
  inlineStyles: true,
  removeScripts: true,
  includeMetadata: true,
  filenameTemplate: "{title}-{date}.html",
  autoSave: false
};

const form = document.querySelector("#options");
const statusNode = document.querySelector("#status");

restoreOptions();

form.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(form);
  await chrome.storage.sync.set({
    includeFrames: data.has("includeFrames"),
    inlineImages: data.has("inlineImages"),
    inlineStyles: data.has("inlineStyles"),
    removeScripts: data.has("removeScripts"),
    includeMetadata: data.has("includeMetadata"),
    autoSave: data.has("autoSave"),
    filenameTemplate: String(data.get("filenameTemplate") || DEFAULT_OPTIONS.filenameTemplate).trim()
  });

  statusNode.textContent = "Options saved.";
  setTimeout(() => {
    statusNode.textContent = "";
  }, 1600);
});

async function restoreOptions() {
  const options = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  Object.entries(options).forEach(([key, value]) => {
    const input = form.elements[key];
    if (!input) {
      return;
    }
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else {
      input.value = value;
    }
  });
}
