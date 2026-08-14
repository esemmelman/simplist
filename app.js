const SUPABASE_URL = "https://fgomaujsdblpzxhnnqrg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JOUqLZDnfGu_yCa6k6FVDQ_AYwpr72i";
const TABLE_NAME = "simplist_items_v1";
const APP_VERSION = "1.1.0";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const authGate = document.querySelector("#auth-gate");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const itemList = document.querySelector("#item-list");
const editor = document.querySelector("#notes-editor");
const saveStatus = document.querySelector("#save-status");

let items = [];
let selectedId = null;
let saveDebounceTimer;
let statusTimer;
let pendingSave = null;
let saveQueue = Promise.resolve(true);
let currentUser = null;

document.querySelector("#app-version").textContent = `v${APP_VERSION}`;

function selectedItem() {
  return items.find((item) => item.id === selectedId);
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
  editor.innerHTML = item?.notes_html ?? "";
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
  const title = window.prompt("Item name:");
  if (!title?.trim()) return;
  const { data, error } = await db
    .from(TABLE_NAME)
    .insert({ title: title.trim(), user_id: currentUser.id })
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
  const title = window.prompt("Rename item:", item.title);
  if (!title?.trim()) return;
  const { error } = await db.from(TABLE_NAME).update({ title: title.trim(), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return showStatus(error.message, true);
  item.title = title.trim();
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
  pendingSave = { itemId: selectedId, notesHtml: editor.innerHTML };
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
  const stamp = `[${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}]`;
  document.execCommand("insertText", false, stamp);
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
