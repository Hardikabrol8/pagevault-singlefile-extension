const saveButton = document.querySelector("#save");
const saveSelectionButton = document.querySelector("#save-selection");
const saveAllButton = document.querySelector("#save-all");
const autoSaveInput = document.querySelector("#auto-save");
const optionsButton = document.querySelector("#options");
const statusNode = document.querySelector("#status");

restorePopupState();

saveButton.addEventListener("click", () => {
  runAction("save-active-tab", "Saving page...");
});

saveSelectionButton.addEventListener("click", () => {
  runAction("save-selection", "Saving selected content...");
});

saveAllButton.addEventListener("click", () => {
  runAction("save-all-tabs", "Saving all tabs...");
});

autoSaveInput.addEventListener("change", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "set-auto-save",
    autoSave: autoSaveInput.checked
  });
  statusNode.textContent = response?.ok ? "Auto-save updated." : "Could not update auto-save.";
});

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function restorePopupState() {
  const response = await chrome.runtime.sendMessage({ type: "get-options" });
  if (response?.ok) {
    autoSaveInput.checked = Boolean(response.options.autoSave);
  }
}

async function runAction(type, pendingText) {
  setButtonsDisabled(true);
  statusNode.textContent = pendingText;

  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.ok) {
      throw new Error(response?.error || "Save failed.");
    }
    if (type === "save-all-tabs") {
      statusNode.textContent = `Saved ${response.result.saved} of ${response.result.total} tabs.`;
      return;
    }
    statusNode.textContent = `Saved ${response.result.filename}`;
  } catch (error) {
    statusNode.textContent = error?.message || "Save failed.";
  } finally {
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled) {
  saveButton.disabled = disabled;
  saveSelectionButton.disabled = disabled;
  saveAllButton.disabled = disabled;
}
