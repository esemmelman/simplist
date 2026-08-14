const SUPABASE_URL = "https://fgomaujsdblpzxhnnqrg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JOUqLZDnfGu_yCa6k6FVDQ_AYwpr72i";
const TABLE_NAME = "simplist_items_v1";
const APP_VERSION = "1.2.0";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const authGate = document.querySelector("#auth-gate");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const itemList = document.querySelector("#item-list");
const editor = document.querySelector("#notes-editor");
const saveStatus = document.querySelector("#save-status");
const itemDialog = document.querySelector("#item-dialog");
const itemDialogForm = document.querySelector("#item-dialog-form");
const itemDialogHeading = document.querySelector("#item-dialog-heading");
const itemDialogInput = document.querySelector("#item-dialog-input");

let items = [];
let selectedId = null;
let saveDebounceTimer;
let statusTimer;
let pendingSave = null;
let saveQueue = Promise.resolve(true);
let currentUser = null;
let resolveItemDialog = null;

document.querySelector("#app-version").textContent = `v${APP_VERSION}`;

function finishItemDialog(value) {
  if (!resolveItemDialog) return;
  const resolve = resolveItemDialog;
  resolveItemDialog = null;
  if (itemDialog.open) itemDialog.close();
  resolve(value);
}

function requestItemTitle(heading, value = "") {
  itemDialogHeading.textContent = heading;
  itemDialogInput.value = value;
  itemDialog.showModal();
  requestAnimationFrame(() => {
    itemDialogInput.focus();
    itemDialogInput.select();
  });
  return new Promise((resolve) => {
    resolveItemDialog = resolve;
  });
}

itemDialogForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = itemDialogInput.value.trim();
  if (!title) {
    itemDialogInput.setCustomValidity("Enter an item name.");
    itemDialogInput.reportValidity();
    return;
  }
  finishItemDialog(title);
});
itemDialogInput.addEventListener("input", () => itemDialogInput.setCustomValidity(""));
document.querySelector("#item-dialog-cancel").addEventListener("click", () => finishItemDialog(null));
itemDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishItemDialog(null);
});

function selectedItem() {
  return items.find((item) => item.id === selectedId);
}

function linkifyHtml(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement.closest("a")) textNodes.push(walker.currentNode);
  }

  const urlPattern = /(?:https?:\/\/|www\.|[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,})[^\s<]*/gi;
  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let changed = false;

    for (const match of text.matchAll(urlPattern)) {
      if (match.index > 0 && text[match.index - 1] === "@") continue;
      let url = match[0];
      const trailing = url.match(/[),.;!?]+$/)?.[0] ?? "";
      if (trailing) url = url.slice(0, -trailing.length);
      if (!url) continue;
      changed = true;
      fragment.append(text.slice(lastIndex, match.index));
      const link = document.createElement("a");
      link.href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = url;
      fragment.append(link, trailing);
      lastIndex = match.index + match[0].length;
    }

    if (changed) {
      fragment.append(text.slice(lastIndex));
      textNode.replaceWith(fragment);
    }
  });
  return container.innerHTML;
}

function showStatus(message, isError = false) {
  clearTimeout(statusTimer);
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? "#a10f0f" : "#666";
  saveStatus.classList.add("visible");
  if (!isError) statusTimer = setTimeout(() => saveStatus.classList.remove("visible"), 900);
}

function renderItems() {
  itemList.replaceChildren();
  [...items]
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }))
    .forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `item-row${item.id === selectedId ? " selected" : ""}`;
      button.textContent = item.title;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(item.id === selectedId));
      button.addEventListener("click", () => selectItem(item.id));
      button.addEventListener("dblclick", () => renameItem(item.id));
      itemList.append(button);
    });
}

function renderEditor() {
  const item = selectedItem();
  editor.contentEditable = String(Boolean(item));
  editor.innerHTML = linkifyHtml(item?.notes_html ?? "");
}

async function loadItems() {
  showStatus("Loading…");
  const { data, error } = await db
    .from(TABLE_NAME)
    .select("id, title, notes_html, created_at, updated_at")
    .order("title", { ascending: true });
  if (error) return showStatus(error.message, true);
  items = data;
  if (!items.some((item) => item.id === selectedId)) selectedId = items[0]?.id ?? null;
  renderItems();
  renderEditor();
  showStatus("Saved");
}

function selectItem(id) {
  flushPendingSave();
  selectedId = id;
  renderItems();
  renderEditor();
}

async function addItem() {
  if (!(await flushPendingSave())) return;
  const title = await requestItemTitle("Add item");
  if (!title) return;
  const { data, error } = await db
    .from(TABLE_NAME)
    .insert({ title, user_id: currentUser.id })
    .select("id, title, notes_html, created_at, updated_at")
    .single();
  if (error) return showStatus(error.message, true);
  items.push(data);
  selectedId = data.id;
  renderItems();
  renderEditor();
  showStatus("Saved");
  editor.focus();
}

async function renameItem(id = selectedId) {
  if (!(await flushPendingSave())) return;
  const item = items.find((entry) => entry.id === id);
  if (!item) return;
  const title = await requestItemTitle("Rename item", item.title);
  if (!title) return;
  const { error } = await db.from(TABLE_NAME).update({ title, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return showStatus(error.message, true);
  item.title = title;
  renderItems();
  showStatus("Saved");
}

async function deleteItem() {
  const item = selectedItem();
  if (!item || !window.confirm(`Delete “${item.title}”?`)) return;
  if (!(await flushPendingSave())) return;
  const { error } = await db.from(TABLE_NAME).delete().eq("id", item.id);
  if (error) return showStatus(error.message, true);
  const index = items.findIndex((entry) => entry.id === item.id);
  items.splice(index, 1);
  selectedId = items[Math.min(index, items.length - 1)]?.id ?? null;
  renderItems();
  renderEditor();
  showStatus("Saved");
}

async function saveNote({ itemId, notesHtml }) {
  showStatus("Saving…");
  const { error } = await db
    .from(TABLE_NAME)
    .update({ notes_html: notesHtml, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) {
    showStatus(error.message, true);
    return false;
  }
  const item = items.find((entry) => entry.id === itemId);
  if (item) item.notes_html = notesHtml;
  showStatus("Saved");
  return true;
}

function enqueueSave(snapshot) {
  saveQueue = saveQueue
    .catch(() => false)
    .then(() => saveNote(snapshot))
    .catch((error) => {
      showStatus(error?.message ?? "Unable to save", true);
      return false;
    });
  return saveQueue;
}

function scheduleCurrentNoteSave(delay = 400) {
  if (!selectedItem()) return Promise.resolve(true);
  clearTimeout(saveDebounceTimer);
  pendingSave = { itemId: selectedId, notesHtml: linkifyHtml(editor.innerHTML) };
  if (delay === 0) return flushPendingSave();
  saveDebounceTimer = setTimeout(flushPendingSave, delay);
  return Promise.resolve(true);
}

function flushPendingSave() {
  clearTimeout(saveDebounceTimer);
  if (!pendingSave) return saveQueue;
  const snapshot = pendingSave;
  pendingSave = null;
  return enqueueSave(snapshot);
}

function insertTimestamp() {
  editor.focus();
  const now = new Date();
  const hour = now.getHours() % 12 || 12;
  const period = now.getHours() < 12 ? "am" : "pm";
  const stamp = `${now.getMonth() + 1}-${now.getDate()}-${now.getFullYear()} ${hour}:${String(now.getMinutes()).padStart(2, "0")} ${period}`;
  const hasContent = editor.textContent.trim() !== "";
  const makeLine = (content) => {
    const line = document.createElement("div");
    if (content) line.append(content);
    else line.append(document.createElement("br"));
    return line;
  };
  const timestamp = document.createElement("strong");
  timestamp.textContent = stamp;
  const cursorLine = makeLine();

  if (hasContent) {
    editor.append(makeLine(), makeLine(), makeLine(timestamp), cursorLine);
  } else {
    editor.replaceChildren(timestamp, cursorLine);
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(cursorLine, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  scheduleCurrentNoteSave(0);
}

async function authenticate(mode) {
  authMessage.textContent = "Working…";
  const credentials = {
    email: document.querySelector("#auth-email").value.trim(),
    password: document.querySelector("#auth-password").value
  };
  const { error } = mode === "signup"
    ? await db.auth.signUp(credentials)
    : await db.auth.signInWithPassword(credentials);
  authMessage.textContent = error ? error.message : (mode === "signup" ? "Account created. Check your email if confirmation is required." : "");
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  authenticate("signin");
});
document.querySelector("#sign-up").addEventListener("click", () => authenticate("signup"));
document.querySelector("#sign-out").addEventListener("click", async () => {
  const saved = await flushPendingSave();
  if (saved) await db.auth.signOut();
});
document.querySelector("#add-item").addEventListener("click", addItem);
document.querySelector("#rename-item").addEventListener("click", () => renameItem());
document.querySelector("#delete-item").addEventListener("click", deleteItem);
document.querySelector("#add-timestamp").addEventListener("click", insertTimestamp);

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    editor.focus();
    document.execCommand(button.dataset.command, false);
    scheduleCurrentNoteSave(0);
  });
});

editor.addEventListener("input", () => {
  scheduleCurrentNoteSave();
});

editor.addEventListener("blur", () => {
  if (!selectedItem()) return;
  const linkedHtml = linkifyHtml(editor.innerHTML);
  if (linkedHtml !== editor.innerHTML) {
    editor.innerHTML = linkedHtml;
    scheduleCurrentNoteSave(0);
  }
});

editor.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;
  event.preventDefault();
  window.open(link.href, "_blank", "noopener,noreferrer");
});

db.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user ?? null;
  authGate.hidden = Boolean(currentUser);
  if (currentUser) {
    authMessage.textContent = "";
    loadItems();
  } else {
    items = [];
    selectedId = null;
    renderItems();
    renderEditor();
  }
});
