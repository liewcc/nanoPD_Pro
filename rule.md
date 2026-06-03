# AI Agent Guidelines

As an AI agent working in this repository, you MUST strictly adhere to the following rules to ensure codebase integrity, premium design consistency, and smooth collaboration.

---

## 1. Version Control & File Exclusions

> [!IMPORTANT]
> **Local Dependency Sanitation**
> Since this is designed as a self-contained "green" (portable) software framework, local dependency environments MUST NOT be tracked in Git.

- **NEVER** stage, commit, or push the local environment folders:
  - `.venv/` (Python virtual environment)
  - `.node_portable/` (Portable Node.js binary files)
  - `node_modules/` (Local Node package dependencies)
- **NEVER** track runtime data, logs, or system artifacts:
  - `*.log` (e.g., backend uvicorn outputs, node logs)
  - `.env` or configurations containing API keys / credentials
- Run `git status` explicitly before committing to verify untracked paths. Use `.gitignore` to prevent leakage.

---

## 2. Codebase & UI Language Standards & File Language

- **All Repository Files:** All files in the repository (including source code, documentation, configuration, README, etc.) **MUST be written in English**.
- **UI Elements:** All User Interface strings, labels, logs, dashboards, and placeholders **MUST be written in English**. 
- **Documentation & Comments:** Inline code comments, function docstrings, and backend terminal prints must be written in English to support developer reading.

---

## 3. Conversational Language (Agent-to-User)

- **Main Language:** All discussions and explanations in the chatbox window with the user must be conducted in **Chinese (中文)**.
- **Terminology Mixing:** When discussing technical topics, you should seamlessly mix English terms for variables, files, APIs, and UI controls into your Chinese sentences. 
  - *Example:* "请通过 `run.bat` 运行程序，打开后前端会通过 fetch 请求 FastAPI 的 `/api/diagnostics` 接口进行数据刷新。"
  - *Example:* "检查 `main.js` 中的 `BrowserWindow` 参数，修改 `width` 和 `height` 以调整主窗口尺寸。"

---

## 4. UI Style Guide: Gemini Advanced Aesthetics

> [!TIP]
> **UI Aesthetic Standard**
> All frontend components must look premium, modern, and mimic the Google Gemini / Gemini Advanced (Persona Pro) aesthetic. No cheap, default browser elements are allowed.

- **Color Palette:**
  - Deep dark background: `#0f0f10` (App shell) and `#131314` (Sidebar).
  - Elegant container cards: `#1e1f20` / `#232429` (rounded borders, slight outline of `rgba(255, 255, 255, 0.08)`).
  - Brand Accent Gradient: `linear-gradient(135deg, #4285f4 0%, #9b51e0 50%, #ea4335 100%)`.
- **Typography:**
  - Standard Headings: Use the `'Outfit'` Google Font.
  - Body Text: Use the `'Inter'` Google Font.
  - Monospace/Code: Use `'Cascadia Code'` or `Consolas`.
- **Card Spacing:**
  - Maintain generous spacing: cards padding must be at least `24px` with a grid gap of `24px`.
  - Cards must use a rounded corner radius of `20px` to look premium and soft.
  - Hover micro-animations must scale container cards up (`transform: translateY(-4px)`) and trigger subtle purple glow shadow effects.

---

## 5. Electron + Python Backend Integration

- **Port Assignment:** Never hardcode backend port endpoints. Always use the dynamic port scan routine in `main.js` (starts checking at port `9000`) and pass it down via query parameter (`index.html?port=XXXX`) and command arguments (`--port XXXX`).
- **Process Trees:** When Electron exits, kill the Python backend process and all its subprocesses using process tree terminators (`taskkill /pid [PID] /f /t` on Windows) to prevent background zombie processes.

---

## 6. Collaboration & Communication Protocol

- **Short Responses:** Keep explanations to the user brief, precise, and highly readable.
- **AST Integrity:** When making file updates, do not leave dangling brackets `}`, mismatched brackets, or copy-paste duplicates. Prefer clean edits.
- **Checklist Tracking:** Follow the `task.md` checklist pattern, marking completed tasks with `[x]` and in-progress tasks with `[/]`.
