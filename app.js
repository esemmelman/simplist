const STORAGE_KEY = "simplist-data-v1";

const defaultItems = [
  {
    id: crypto.randomUUID(),
    title: "Isaak Tutoring",
    notes: "I have to get back to her with an answer by Sunday.<br>[03-13 17:22]<br><br>This is a<br>[06-25 15:09]<br>[06-25 15:10]"
  },
  { id: crypto.randomUUID(), title: "test", notes: "" }
];

const itemList = document.querySelector("#item-list");
const editor = document.querySelector("#notes-editor");
const saveStatus = document.querySelector("#save-status");
let saveTimer;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.items?.length) return saved;
  } catch (_) {
    // Ignore invalid saved data and start with the sample list.
  }
  return { items: defaultItems, selectedId: defaultItems[0].id };
}

let state = loadState();
if (!state.items.some((item) => item.id === state.selectedId)) {
  state.selectedId = state.items[0]?.id ?? null;
}

function selectedItem() {
  return state.items.find((item) => item.id === state.selectedId);
}

function persist(showConfirmation = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!showConfirmation) return;
  clearTimeout(saveTimer);
  saveStatus.classList.add("visible");
  saveTimer = setTimeout(() => saveStatus.classList.remove("visible"), 900);
}

function renderItems() {
  itemList.replaceChildren();
  const sortedItems = [...state.items].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true })
  );
  sortedItems.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item-row${item.id === state.selectedId ? " selected" : ""}`;
    button.textContent = item.title;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(item.id === state.selectedId));
    button.addEventListener("click", () => selectItem(item.id));
    button.addEventListener("dblclick", () => renameItem(item.id));
    itemList.append(button);
  });
}

function renderEditor() {
  const item = selectedItem();
  editor.contentEditable = String(Boolean(item));
  editor.innerHTML = item?.notes ?? "";
}

function selectItem(id) {
  saveCurrentNote(false);
  state.selectedId = id;
  renderItems();
  renderEditor();
  persist(false);
}

function addItem() {
  const title = window.prompt("Item name:");
  if (!title?.trim()) return;
  const item = { id: crypto.randomUUID(), title: title.trim(), notes: "" };
  state.items.push(item);
  state.selectedId = item.id;
  renderItems();
  renderEditor();
  persist();
  editor.focus();
}

function renameItem(id = state.selectedId) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const title = window.prompt("Rename item:", item.title);
  if (!title?.trim()) return;
  item.title = title.trim();
  renderItems();
  persist();
}

function deleteItem() {
  const item = selectedItem();
  if (!item || !window.confirm(`Delete “${item.title}”?`)) return;
  const index = state.items.findIndex((entry) => entry.id === item.id);
  state.items.splice(index, 1);
  state.selectedId = state.items[Math.min(index, state.items.length - 1)]?.id ?? null;
  renderItems();
  renderEditor();
  persist();
}

function saveCurrentNote(showConfirmation = true) {
  const item = selectedItem();
  if (!item) return;
  item.notes = editor.innerHTML;
  persist(showConfirmation);
}

function insertTimestamp() {
  editor.focus();
  const now = new Date();
  const stamp = `[${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}]`;
  document.execCommand("insertText", false, stamp);
  saveCurrentNote();
}

document.querySelector("#add-item").addEventListener("click", addItem);
document.querySelector("#rename-item").addEventListener("click", () => renameItem());
document.querySelector("#delete-item").addEventListener("click", deleteItem);
document.querySelector("#add-timestamp").addEventListener("click", insertTimestamp);

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    editor.focus();
    document.execCommand(button.dataset.command, false);
    saveCurrentNote();
  });
});

editor.addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrentNote(), 350);
});

window.addEventListener("beforeunload", () => saveCurrentNote(false));

renderItems();
renderEditor();
