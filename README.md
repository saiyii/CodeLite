# Still building it so its not really ideal to use.

# CodeLite

A lightweight, open-source code editor built on [Tauri](https://tauri.app/) and the
[Monaco Editor](https://microsoft.github.io/monaco-editor/) (the engine behind VS Code).

- **Every language Monaco ships with** works out of the box — JavaScript/TypeScript, Python,
  Rust, Go, C/C++, C#, Java, PHP, Ruby, Lua, HTML/CSS/JSON/YAML, Markdown, SQL, shell scripts,
  and dozens more. No extension install required.
- **Small footprint** — Tauri uses the OS's native webview instead of bundling Chromium, so the
  installer and running app stay small compared to Electron-based editors.
- **Extensible through a plain JSON file** instead of a plugin API: drop a `.codelite/runners.json`
  in a project to teach CodeLite how to run it — a game engine like LÖVE2D, a custom build
  script, anything that's just a shell command.

## Features

- File tree with lazy folder loading
- Multi-tab editing with unsaved-changes indicators
- One-click "Run" that matches the open file or project against configurable run commands,
  streaming stdout/stderr into an output panel
- Light/dark theme toggle
- Resizable sidebar and output panel

## Building from source

You need:

- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Node.js](https://nodejs.org/) 20+

```sh
npm install
npm run tauri build
```

The release binary and platform installers are written to `src-tauri/target/release/` and
`src-tauri/target/release/bundle/` respectively (e.g. an `.exe`, an NSIS `-setup.exe`, and an
`.msi` on Windows; a `.dmg`/`.app` on macOS; a `.deb`/`.AppImage` on Linux).

For local development with hot reload:

```sh
npm install
npm run tauri dev
```

## Adding a run configuration

Click **Run Configs** in the toolbar (with a folder open) to create `.codelite/runners.json` in
your project, pre-filled with the built-in defaults. Each entry looks like:

```json
{
  "name": "LÖVE2D",
  "match": { "filesPresent": ["conf.lua", "main.lua"] },
  "command": "love",
  "args": ["${projectRoot}"]
}
```

- `match.filesPresent` matches against files/folders at the project root (checked before
  per-file rules — useful for whole-project tools).
- `match.extensions` matches the currently active file's extension (e.g. `.py`).
- `command`/`args` support `${file}`, `${fileDir}`, `${fileName}`, `${fileNameNoExt}`, and
  `${projectRoot}` placeholders.

Entries in your project's `.codelite/runners.json` are checked before the built-in defaults, so
you can override or add to them freely.

## License

MIT — see [LICENSE](LICENSE).
#
