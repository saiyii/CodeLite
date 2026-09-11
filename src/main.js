import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import defaultRunners from "./default-runners.json";
import { icons } from "./icons.js";

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

// ---------- state ----------
const state = {
  projectRoot: null,
  projectEntries: [], // top-level dir listing, refreshed on open
  allKnownFileNames: new Set(), // file/dir basenames seen while browsing the tree, used for run-config matching
  openFiles: new Map(), // path -> { model, viewState, dirty, name }
  activeFile: null,
  runId: null,
  theme: localStorage.getItem("codelite-theme") || "dark",
};

// ---------- dom refs ----------
const el = {
  fileTree: document.getElementById("file-tree"),
  tabs: document.getElementById("tabs"),
  editorContainer: document.getElementById("editor-container"),
  outputContent: document.getElementById("output-content"),
  projectName: document.getElementById("project-name"),
  statusLeft: document.getElementById("status-left"),
  statusRight: document.getElementById("status-right"),
  btnOpenFolder: document.getElementById("btn-open-folder"),
  btnOpenFile: document.getElementById("btn-open-file"),
  btnSave: document.getElementById("btn-save"),
  btnRun: document.getElementById("btn-run"),
  btnStop: document.getElementById("btn-stop"),
  btnEditRunners: document.getElementById("btn-edit-runners"),
  btnClearOutput: document.getElementById("btn-clear-output"),
  btnTheme: document.getElementById("btn-theme"),
  sidebar: document.getElementById("sidebar"),
  outputPanel: document.getElementById("output-panel"),
  resizerSidebar: document.getElementById("resizer-sidebar"),
  resizerOutput: document.getElementById("resizer-output"),
  welcomeScreen: document.getElementById("welcome-screen"),
  treeEmptyHint: document.getElementById("tree-empty-hint"),
  welcomeOpenFolder: document.getElementById("welcome-open-folder"),
  welcomeOpenFile: document.getElementById("welcome-open-file"),
};

function updateWelcomeVisibility() {
  el.welcomeScreen.style.display = state.openFiles.size === 0 ? "flex" : "none";
}

// ---------- monaco editor ----------
monaco.editor.defineTheme("codelite-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {},
});

const editor = monaco.editor.create(el.editorContainer, {
  value: "",
  language: "plaintext",
  theme: state.theme === "dark" ? "codelite-dark" : "vs",
  automaticLayout: true,
  fontSize: 14,
  fontFamily: "Cascadia Code, Consolas, monospace",
  minimap: { enabled: true },
  scrollBeyondLastLine: false,
});

editor.onDidChangeModelContent(() => {
  const f = state.openFiles.get(state.activeFile);
  if (f && !f.dirty) {
    f.dirty = true;
    renderTabs();
  }
});

applyTheme(state.theme);

// ---------- language detection (leverages Monaco's built-in language registry) ----------
function languageForPath(path) {
  const base = path.split(/[/\\]/).pop() || "";
  const ext = base.includes(".") ? "." + base.split(".").pop().toLowerCase() : "";
  const languages = monaco.languages.getLanguages();
  for (const lang of languages) {
    if (lang.filenames && lang.filenames.includes(base)) return lang.id;
  }
  for (const lang of languages) {
    if (lang.extensions && lang.extensions.includes(ext)) return lang.id;
  }
  return "plaintext";
}

// ---------- file tree ----------
async function openFolder(path) {
  state.projectRoot = path;
  state.allKnownFileNames = new Set();
  el.projectName.textContent = path;
  el.fileTree.innerHTML = "";
  const entries = await invoke("read_dir_tree", { path });
  state.projectEntries = entries;
  for (const entry of entries) state.allKnownFileNames.add(entry.name);
  renderTree(entries, el.fileTree, 0);
  setStatus(`Opened ${path}`);
}

function renderTree(entries, container, depth) {
  entries.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    const node = document.createElement("div");
    node.className = "tree-node" + (entry.is_dir ? " is-dir" : "");
    node.style.paddingLeft = 8 + depth * 14 + "px";
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.innerHTML = entry.is_dir ? icons.chevron : "";
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.innerHTML = entry.is_dir ? icons.folder : icons.file;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = entry.name;
    node.appendChild(chevron);
    node.appendChild(icon);
    node.appendChild(label);
    container.appendChild(node);

    if (entry.is_dir) {
      let expanded = false;
      let childrenEl = null;
      node.addEventListener("click", async () => {
        expanded = !expanded;
        node.classList.toggle("expanded", expanded);
        icon.innerHTML = expanded ? icons.folderOpen : icons.folder;
        if (expanded) {
          if (!childrenEl) {
            childrenEl = document.createElement("div");
            childrenEl.className = "tree-children";
            container.insertBefore(childrenEl, node.nextSibling);
            const children = await invoke("read_dir_tree", { path: entry.path });
            for (const c of children) state.allKnownFileNames.add(c.name);
            renderTree(children, childrenEl, depth + 1);
          }
          childrenEl.style.display = "";
        } else if (childrenEl) {
          childrenEl.style.display = "none";
        }
      });
    } else {
      node.addEventListener("click", () => {
        document.querySelectorAll(".tree-node.selected").forEach((n) => n.classList.remove("selected"));
        node.classList.add("selected");
        openFile(entry.path);
      });
    }
  }
}

// ---------- tabs / open files ----------
async function openFile(path) {
  if (!state.openFiles.has(path)) {
    let contents;
    try {
      contents = await invoke("read_file", { path });
    } catch (e) {
      setStatus(`Failed to open ${path}: ${e}`, true);
      return;
    }
    const name = path.split(/[/\\]/).pop();
    const model = monaco.editor.createModel(contents, languageForPath(path));
    state.openFiles.set(path, { model, viewState: null, dirty: false, name });
    updateWelcomeVisibility();
  }
  activateFile(path);
}

function activateFile(path) {
  if (state.activeFile === path) return;
  if (state.activeFile && state.openFiles.has(state.activeFile)) {
    state.openFiles.get(state.activeFile).viewState = editor.saveViewState();
  }
  state.activeFile = path;
  const f = state.openFiles.get(path);
  editor.setModel(f.model);
  if (f.viewState) editor.restoreViewState(f.viewState);
  editor.focus();
  renderTabs();
}

function closeFile(path) {
  const f = state.openFiles.get(path);
  if (!f) return;
  if (f.dirty && !confirm(`Discard unsaved changes in ${f.name}?`)) return;
  f.model.dispose();
  state.openFiles.delete(path);
  if (state.activeFile === path) {
    state.activeFile = null;
    const remaining = [...state.openFiles.keys()];
    if (remaining.length) activateFile(remaining[remaining.length - 1]);
    else editor.setModel(monaco.editor.createModel("", "plaintext"));
  }
  updateWelcomeVisibility();
  renderTabs();
}

function renderTabs() {
  el.tabs.innerHTML = "";
  for (const [path, f] of state.openFiles) {
    const tab = document.createElement("div");
    tab.className = "tab" + (path === state.activeFile ? " active" : "") + (f.dirty ? " dirty" : "");
    tab.title = path;

    const fileIcon = document.createElement("span");
    fileIcon.className = "icon";
    fileIcon.innerHTML = icons.file;
    const dot = document.createElement("span");
    dot.className = "dirty-dot";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = f.name;
    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.innerHTML = icons.close;
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeFile(path);
    });

    tab.appendChild(fileIcon);
    tab.appendChild(label);
    tab.appendChild(dot);
    tab.appendChild(closeBtn);
    tab.addEventListener("click", () => activateFile(path));
    el.tabs.appendChild(tab);
  }
}

async function saveActiveFile() {
  if (!state.activeFile) return;
  const f = state.openFiles.get(state.activeFile);
  try {
    await invoke("write_file", { path: state.activeFile, contents: f.model.getValue() });
    f.dirty = false;
    renderTabs();
    setStatus(`Saved ${f.name}`);
  } catch (e) {
    setStatus(`Failed to save: ${e}`, true);
  }
}

// ---------- running ----------
function substitute(template, vars) {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : ""));
}

async function loadRunners() {
  let projectRunners = [];
  if (state.projectRoot) {
    try {
      const raw = await invoke("read_file", { path: joinPath(state.projectRoot, ".codelite/runners.json") });
      projectRunners = JSON.parse(raw);
    } catch {
      // no project-level overrides, that's fine
    }
  }
  return [...projectRunners, ...defaultRunners];
}

function joinPath(...parts) {
  return parts.join("/").replace(/\\/g, "/");
}

function pickRunner(runners) {
  const projectFiles = state.allKnownFileNames;
  for (const r of runners) {
    if (r.match?.filesPresent?.length && state.projectRoot) {
      if (r.match.filesPresent.every((f) => projectFiles.has(f))) return r;
    }
  }
  if (state.activeFile) {
    const base = state.activeFile.split(/[/\\]/).pop();
    const ext = base.includes(".") ? "." + base.split(".").pop().toLowerCase() : "";
    for (const r of runners) {
      if (r.match?.extensions?.includes(ext)) return r;
    }
  }
  return null;
}

async function runCurrent() {
  const runners = await loadRunners();
  const runner = pickRunner(runners);
  if (!runner) {
    setStatus("No matching run configuration for this file/project.", true);
    appendOutput(`No run configuration matched. Open a file or add one via "Run Configs".\n`, "stderr");
    return;
  }

  const file = state.activeFile || "";
  const fileDir = file ? file.slice(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"))) : "";
  const base = file.split(/[/\\]/).pop() || "";
  const fileNameNoExt = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const vars = {
    file,
    fileDir,
    fileName: base,
    fileNameNoExt,
    projectRoot: state.projectRoot || fileDir,
  };

  const program = substitute(runner.command, vars);
  const args = (runner.args || []).map((a) => substitute(a, vars));
  const cwd = state.projectRoot || fileDir || ".";
  const id = crypto.randomUUID();
  state.runId = id;

  clearOutput();
  appendOutput(`$ ${runner.name}: ${program} ${args.join(" ")}\n`, "info");
  setRunning(true);

  try {
    await invoke("run_command", { id, cwd, program, args });
  } catch (e) {
    appendOutput(`Failed to start: ${e}\n`, "stderr");
    setRunning(false);
  }
}

async function stopCurrent() {
  if (!state.runId) return;
  try {
    await invoke("stop_command", { id: state.runId });
  } catch (e) {
    appendOutput(`Failed to stop: ${e}\n`, "stderr");
  }
}

function setRunning(isRunning) {
  el.btnRun.disabled = isRunning;
  el.btnStop.disabled = !isRunning;
}

function appendOutput(text, kind) {
  const span = document.createElement("span");
  if (kind === "stderr") span.className = "output-line-stderr";
  if (kind === "exit") span.className = "output-line-exit";
  span.textContent = text;
  el.outputContent.appendChild(span);
  el.outputContent.scrollTop = el.outputContent.scrollHeight;
}

function clearOutput() {
  el.outputContent.innerHTML = "";
}

listen("run-output", (event) => {
  const { id, stream, line } = event.payload;
  if (id !== state.runId) return;
  appendOutput(line + "\n", stream === "stderr" ? "stderr" : undefined);
});

listen("run-exit", (event) => {
  const { id, code } = event.payload;
  if (id !== state.runId) return;
  appendOutput(`\nProcess exited with code ${code}\n`, "exit");
  setRunning(false);
});

// ---------- run configs editing ----------
async function editRunnerConfig() {
  if (!state.projectRoot) {
    setStatus("Open a folder first to create a project run configuration.", true);
    return;
  }
  const path = await invoke("ensure_project_runners_config", {
    projectPath: state.projectRoot,
    defaults: defaultRunners,
  });
  openFile(path);
}

// ---------- theme ----------
function applyTheme(theme) {
  document.documentElement.classList.toggle("light", theme === "light");
  monaco.editor.setTheme(theme === "light" ? "vs" : "codelite-dark");
}

el.btnTheme.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("codelite-theme", state.theme);
  applyTheme(state.theme);
});

// ---------- status bar ----------
let statusTimeout;
function setStatus(msg, isError) {
  el.statusLeft.textContent = msg;
  el.statusLeft.style.color = isError ? "var(--danger)" : "";
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => {
    el.statusLeft.textContent = "Ready";
    el.statusLeft.style.color = "";
  }, 4000);
}

// ---------- resizers ----------
function makeResizer(handle, onDrag) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("active");
    const onMove = (ev) => onDrag(ev);
    const onUp = () => {
      handle.classList.remove("active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

makeResizer(el.resizerSidebar, (e) => {
  const rect = document.getElementById("body").getBoundingClientRect();
  const width = Math.min(Math.max(e.clientX - rect.left, 120), 600);
  el.sidebar.style.width = width + "px";
});

makeResizer(el.resizerOutput, (e) => {
  const rect = document.getElementById("main").getBoundingClientRect();
  const height = Math.min(Math.max(rect.bottom - e.clientY, 60), rect.height - 100);
  el.outputPanel.style.height = height + "px";
});

// ---------- wire up buttons ----------
async function pickAndOpenFolder() {
  const path = await invoke("pick_folder");
  if (path) await openFolder(path);
}

async function pickAndOpenFile() {
  const path = await invoke("pick_file");
  if (path) await openFile(path);
}

el.btnOpenFolder.addEventListener("click", pickAndOpenFolder);
el.btnOpenFile.addEventListener("click", pickAndOpenFile);
el.welcomeOpenFolder.addEventListener("click", pickAndOpenFolder);
el.welcomeOpenFile.addEventListener("click", pickAndOpenFile);

el.btnSave.addEventListener("click", saveActiveFile);
el.btnRun.addEventListener("click", runCurrent);
el.btnStop.addEventListener("click", stopCurrent);
el.btnEditRunners.addEventListener("click", editRunnerConfig);
el.btnClearOutput.addEventListener("click", clearOutput);

window.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveActiveFile();
  }
  if (ctrl && e.key.toLowerCase() === "r") {
    e.preventDefault();
    runCurrent();
  }
});

updateWelcomeVisibility();
setStatus("Welcome to CodeLite");
