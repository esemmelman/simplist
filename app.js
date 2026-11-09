const SUPABASE_URL = "https://fgomaujsdblpzxhnnqrg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JOUqLZDnfGu_yCa6k6FVDQ_AYwpr72i";
const TABLE_NAME = "simplist_items_v1";
const APP_VERSION = "1.2.12";

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
const urlDialog = document.querySelector("#url-dialog");
const urlDialogForm = document.querySelector("#url-dialog-form");
const urlDialogUrl = document.querySelector("#url-dialog-url");
const urlDialogName = document.querySelector("#url-dialog-name");
const speechButton = document.querySelector("#speak-notes");
const speechStatus = document.querySelector("#speech-status");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechSession = null;
let inlineVoiceSession = null;

let items = [];
let selectedId = null;
let saveDebounceTimer;
let statusTimer;
let pendingSave = null;
let saveQueue = Promise.resolve(true);
let currentUser = null;
let resolveItemDialog = null;

document.querySelector("#app-version").textContent = `Version ${APP_VERSION}`;

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

function closeUrlDialog() {
  if (urlDialog.open) urlDialog.close();
}

function normalizeUrl(value) {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only web URLs are supported.');
  return parsed.href;
}

function fallbackCopyLink(name, url) {
  const link = document.createElement("a");
  link.href = url;
  link.textContent = name;
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.className = "clipboard-copy-helper";
  holder.append(link);
  document.body.append(holder);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection.removeAllRanges();
  selection.addRange(range);
  const copied = document.execCommand("copy");
  selection.removeAllRanges();
  holder.remove();
  if (!copied) throw new Error("Unable to copy the URL.");
}

async function copyNamedUrl(name, url) {
  const escapedName = document.createElement("span");
  escapedName.textContent = name;
  const escapedUrl = document.createElement("a");
  escapedUrl.href = url;
  const html = `<a href="${escapedUrl.href}" target="_blank" rel="noopener noreferrer">${escapedName.innerHTML}</a>`;
  const plainText = `${name} (${url})`;
  if (navigator.clipboard?.write && window.ClipboardItem) {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" })
    })]);
  } else {
    fallbackCopyLink(name, url);
  }
}

document.querySelector("#copy-url").addEventListener("click", () => {
  urlDialogForm.reset();
  urlDialog.showModal();
  requestAnimationFrame(() => urlDialogUrl.focus());
});
document.querySelector("#url-dialog-cancel").addEventListener("click", closeUrlDialog);
urlDialog.addEventListener("cancel", closeUrlDialog);
urlDialogForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = urlDialogName.value.trim();
  let url;
  try {
    url = normalizeUrl(urlDialogUrl.value.trim());
  } catch (error) {
    urlDialogUrl.setCustomValidity(error?.message ?? "Enter a valid URL.");
    urlDialogUrl.reportValidity();
    return;
  }
  try {
    await copyNamedUrl(name, url);
    closeUrlDialog();
    showStatus("URL copied");
    editor.focus();
  } catch (error) {
    showStatus(error?.message ?? "Unable to copy the URL.", true);
  }
});
urlDialogUrl.addEventListener("input", () => urlDialogUrl.setCustomValidity(""));

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
      button.addEventListener("click", () => { selectItem(item.id); copySelectedItem(); });
      button.addEventListener("dblclick", () => renameItem(item.id));
      itemList.append(button);
    });
}

function renderEditor() {
  cancelSpeech();
  const item = selectedItem();
  speechButton.disabled = !item;
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
  renderItems();
  renderEditor();
  showStatus("Saved");
  if(window.parent!==window)window.parent.postMessage({type:"simplist:ready"},location.origin);
}

function selectItem(id) {
  cancelInlineVoice();
  flushPendingSave();
  selectedId = id;
  renderItems();
  renderEditor();
}

async function addItem(title) {
  if (!(await flushPendingSave())) return;
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
  itemList.focus();
  return true;
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
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()];
  const stamp = `${weekday} ${now.getMonth() + 1}-${now.getDate()}-${now.getFullYear()} ${hour}:${String(now.getMinutes()).padStart(2, "0")} ${period}`;
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

function resetSpeech(message = "") {
  speechSession = null;
  speechButton.setAttribute("aria-pressed", "false");
  speechButton.title = "Transcribe speech into Notes";
  speechStatus.textContent = message;
}

function cancelSpeech() {
  const session = speechSession;
  if (!session) return;
  resetSpeech();
  session.recognition.abort();
}

speechButton.addEventListener("click", () => {
  if (speechSession) {
    speechStatus.textContent = "Finishing…";
    speechSession.recognition.stop();
    return;
  }
  if (!selectedItem()) return;
  if (!SpeechRecognition) {
    speechStatus.textContent = "Speech recognition is unavailable in this browser. Try Chrome or Safari.";
    return;
  }

  const recognition = new SpeechRecognition();
  const session = { recognition, itemId: selectedId, nextResult: 0 };
  speechSession = session;
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = navigator.language || document.documentElement.lang || "en-US";
  speechButton.setAttribute("aria-pressed", "true");
  speechButton.title = "Stop transcribing";
  speechStatus.textContent = "Starting microphone…";
  recognition.onstart = () => {
    if (speechSession === session) speechStatus.textContent = "Listening… Click Spk to stop.";
  };
  recognition.onresult = (event) => {
    if (speechSession !== session || selectedId !== session.itemId || !selectedItem()) return;
    for (let i = Math.max(event.resultIndex, session.nextResult); i < event.results.length; i++) {
      if (!event.results[i].isFinal) continue;
      session.nextResult = i + 1;
      const text = event.results[i][0].transcript.trim();
      if (!text) continue;
      // Continue inside the last line instead of appending after its block element.
      let line = editor;
      while (line.lastChild?.nodeType === Node.ELEMENT_NODE &&
        /^(DIV|P|UL|OL|LI|BLOCKQUOTE|H[1-6]|PRE)$/.test(line.lastChild.tagName)) {
        line = line.lastChild;
      }
      if (line.lastChild?.nodeName === "BR") line.lastChild.remove();
      const separator = line.textContent && !/\s$/.test(line.textContent) ? " " : "";
      line.append(document.createTextNode(separator + text));
      editor.scrollTop = editor.scrollHeight;
      scheduleCurrentNoteSave();
    }
  };
  recognition.onerror = (event) => {
    if (speechSession !== session) return;
    const messages = {
      "not-allowed": "Microphone access denied. Allow microphone access and click Spk again.",
      "service-not-allowed": "Speech recognition is blocked by this browser.",
      "audio-capture": "No microphone found. Connect a microphone and try again.",
      "no-speech": "No speech detected. Click Spk to try again.",
      "network": "Speech recognition could not connect. Check your connection and try again."
    };
    resetSpeech(messages[event.error] || "Speech recognition stopped. Click Spk to try again.");
    recognition.abort();
  };
  recognition.onend = () => {
    if (speechSession === session) resetSpeech("Dictation stopped.");
  };
  try {
    recognition.start();
  } catch {
    resetSpeech("Unable to start the microphone. Check microphone access and try again.");
  }
});

window.addEventListener("pagehide", cancelSpeech);

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
  cancelSpeech();
  const saved = await flushPendingSave();
  if (saved) await db.auth.signOut();
});
function cancelInlineVoice() {
  const session = inlineVoiceSession;
  if (!session) return;
  inlineVoiceSession = null;
  clearTimeout(session.timer);
  session.recognition.abort();
  session.input.placeholder = "Type an item, then press Go";
}

function startInlineVoice(input, commit) {
  if (!SpeechRecognition) return;
  cancelSpeech();
  cancelInlineVoice();
  const recognition = new SpeechRecognition();
  const session = { recognition, input, timer: null };
  inlineVoiceSession = session;
  // A list item is one utterance; Android continuous mode can repeat partial phrases.
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";
  const armSave = () => {
    if (inlineVoiceSession !== session) return;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      if (inlineVoiceSession !== session) return;
      cancelInlineVoice();
      if (input.value.trim()) commit();
      else showStatus("No speech detected. Tap blank space to try again.");
    }, 3000);
  };
  recognition.onstart = () => {
    if (inlineVoiceSession !== session) return;
    input.placeholder = "Listening… Tap this item to cancel";
    showStatus("Listening… Tap this item to cancel");
    armSave();
  };
  recognition.onspeechstart = () => {
    if (inlineVoiceSession === session) { clearTimeout(session.timer); session.timer = null; }
  };
  recognition.onresult = event => {
    if (inlineVoiceSession !== session) return;
    const finalParts = [];
    let interim = "";
    for (const result of event.results) {
      if (result.isFinal) finalParts.push(result[0].transcript.trim());
      else interim = result[0].transcript.trim();
    }
    // Interim entries are revised hypotheses, not additional spoken phrases.
    input.value = [...finalParts, interim].filter(Boolean).join(" ").trim()
      .replace(/\p{L}/u, letter => letter.toLocaleUpperCase());
    armSave();
  };
  recognition.onspeechend = armSave;
  recognition.onend = () => {
    if (inlineVoiceSession === session && !session.timer) armSave();
  };
  recognition.onerror = event => {
    if (inlineVoiceSession !== session) return;
    cancelInlineVoice();
    showStatus(event.error === "not-allowed" ? "Allow microphone access, or type your item." : "Voice input stopped. Type your item or try again.", true);
  };
  try { recognition.start(); }
  catch { cancelInlineVoice(); showStatus("Voice input unavailable. Type your item.", true); }
}

function beginInlineItem(useVoice = true) {
  if (!currentUser) return;
  const existing = itemList.querySelector("input");
  if (existing) {
    if (inlineVoiceSession) { cancelInlineVoice(); existing.remove(); showStatus("Voice entry canceled"); }
    else existing.focus();
    return;
  }
  const input = document.createElement("input");
  input.className = "inline-item";
  input.enterKeyHint = "go";
  input.maxLength = 250;
  input.placeholder = "Type an item, then press Go";
  input.setAttribute("aria-label", "New item. Tap again to cancel voice entry.");
  let saving = false;
  const commit = async () => {
    const title = input.value.trim();
    if (saving || !title) return;
    cancelInlineVoice();
    saving = true;
    input.disabled = true;
    try { await addItem(title); }
    finally { saving = false; input.disabled = false; }
  };
  input.addEventListener("click", () => {
    if (!inlineVoiceSession || saving) return;
    cancelInlineVoice();
    input.remove();
    showStatus("Voice entry canceled");
  });
  input.addEventListener("input", cancelInlineVoice);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    if (event.key === "Escape") { cancelInlineVoice(); input.remove(); itemList.focus(); }
  });
  input.addEventListener("blur", () => {
    if (inlineVoiceSession || saving) return;
    if (input.value.trim()) commit(); else input.remove();
  });
  itemList.append(input);
  if (useVoice && SpeechRecognition) startInlineVoice(input, commit);
  else input.focus();
}
itemList.addEventListener("click", event => {
  if (event.target === itemList) beginInlineItem();
});
itemList.addEventListener("keydown", event => {
  if (event.target === itemList && event.key === "Enter") beginInlineItem(false);
});
window.addEventListener("pagehide", cancelInlineVoice);
async function copySelectedItem() {
  const item = selectedItem();
  if (!item) return;
  const notes = editor.innerText.trim();
  try {
    const text = item.title + (notes ? "\n" + notes : "");
    await navigator.clipboard.writeText(text);
    if (await flushPendingSave()) window.parent.postMessage({type:"simplist:copied",copy:{
      token:crypto.randomUUID(),id:item.id,userId:currentUser.id,title:item.title,
      notesHtml:item.notes_html || "",text
    }},location.origin);
    showStatus("Item copied");
  } catch {
    showStatus("Clipboard access blocked. Allow clipboard access to copy items.", true);
  }
}
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
  cancelInlineVoice();
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

// The parent requests removal only after the calendar appointment has saved.
const pendingListRemovals = new Set();
window.addEventListener("message", async event => {
  if (event.origin !== location.origin || event.source !== window.parent || window.parent === window) return;
  if (event.data?.type !== "dayflow:remove-copied-item") return;
  const copy = event.data.copy;
  if (!copy?.token || !copy.id || copy.userId !== currentUser?.id || pendingListRemovals.has(copy.token)) return;
  pendingListRemovals.add(copy.token);
  try {
    if (!(await flushPendingSave())) return;
    const item = items.find(entry => entry.id === copy.id);
    if (item && (item.title !== copy.title || (item.notes_html || "") !== copy.notesHtml)) {
      showStatus("Scheduled item kept in the list because it was edited.");
      event.source.postMessage({type:"simplist:removed",token:copy.token},event.origin);
      return;
    }
    const {error} = await db.from(TABLE_NAME).delete().eq("id",copy.id).eq("user_id",copy.userId)
      .eq("title",copy.title).eq("notes_html",copy.notesHtml);
    if (error) { showStatus("Calendar item saved; list removal will retry when you reopen List.",true); return; }
    // Refresh so a concurrent edit that prevented deletion is still visible.
    await loadItems();
    if (selectedId === copy.id && !items.some(entry => entry.id === copy.id)) {
      selectedId = null; renderItems(); renderEditor();
    }
    event.source.postMessage({type:"simplist:removed",token:copy.token},event.origin);
  } catch { showStatus("Calendar item saved; list removal will retry when you reopen List.",true); }
  finally { pendingListRemovals.delete(copy.token); }
});
