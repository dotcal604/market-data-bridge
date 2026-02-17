# AI CLI Tools — Installation Guide

Install instructions for popular AI coding CLI tools on **Windows Command Prompt**, **PowerShell**, **macOS**, and **Linux**.

---

## Prerequisites

Most tools require **Node.js 18+** (22+ recommended). Install Node.js first if you don't have it:

| Method | Command |
|--------|---------|
| **winget** (Windows) | `winget install OpenJS.NodeJS.LTS --silent` |
| **Chocolatey** (Windows) | `choco install nodejs-lts -y` |
| **Homebrew** (macOS/Linux) | `brew install node` |
| **nvm** (any platform) | `nvm install 22` |

Verify: `node --version` and `npm --version`

---

## 1. Claude Code (Anthropic)

AI coding agent by Anthropic. Runs in your terminal with full codebase context.

### Native installer (recommended)

| Platform | Command |
|----------|---------|
| **PowerShell** | `irm https://claude.ai/install.ps1 \| iex` |
| **Command Prompt** | `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` |
| **macOS / Linux** | `curl -fsSL https://claude.ai/install.sh \| bash` |
| **WinGet** | `winget install Anthropic.ClaudeCode` |

### npm (deprecated but still works)

```
npm install -g @anthropic-ai/claude-code
```

### Install a specific version (PowerShell)

```powershell
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) 1.0.58
```

### Post-install

```
claude --version
claude            # start interactive session
claude doctor     # diagnose issues
```

### Auth

Set your API key or log in via browser when prompted on first launch.

> **Note:** Native installs auto-update. WinGet installs do not — run `winget upgrade Anthropic.ClaudeCode` periodically.

---

## 2. OpenAI Codex CLI

Lightweight coding agent from OpenAI. Requires a ChatGPT Plus/Pro/Business/Enterprise subscription or API key.

### Install

| Platform | Command |
|----------|---------|
| **npm** (all platforms) | `npm install -g @openai/codex` |
| **Homebrew** (macOS) | `brew install --cask codex` |

### Windows notes

Windows support is **experimental**. For the best experience, use WSL:

```powershell
# PowerShell (admin) — install WSL if needed
wsl --install

# Inside WSL terminal
nvm install 22
npm install -g @openai/codex
```

Native PowerShell also works but with sandbox limitations.

### Post-install

```
codex             # start interactive session
codex "prompt"    # single-shot mode
```

### Auth

On first launch, authenticate with your ChatGPT account or set `OPENAI_API_KEY`:

```powershell
# PowerShell (current session)
$env:OPENAI_API_KEY="sk-..."

# PowerShell (permanent)
setx OPENAI_API_KEY "sk-..."
```

```cmd
# Command Prompt
set OPENAI_API_KEY=sk-...

# Command Prompt (permanent)
setx OPENAI_API_KEY "sk-..."
```

---

## 3. Google Gemini CLI

Open-source AI agent by Google. Free tier: 60 requests/min, 1,000 requests/day.

### Install

| Platform | Command |
|----------|---------|
| **npm** (all platforms) | `npm install -g @google/gemini-cli` |
| **npx** (no install) | `npx @google/gemini-cli` |

### Windows (PowerShell)

```powershell
npm install -g @google/gemini-cli
gemini --version
```

Run in an elevated (admin) PowerShell if you encounter permission errors.

### Post-install

```
gemini            # start interactive session
```

On first launch, select a theme and choose "Login with Google" for the free tier, or use an API key.

### Auth with API key

```powershell
# PowerShell (current session)
$env:GEMINI_API_KEY="AIza..."

# PowerShell (permanent)
setx GEMINI_API_KEY "AIza..."
```

```cmd
# Command Prompt
set GEMINI_API_KEY=AIza...

# Command Prompt (permanent)
setx GEMINI_API_KEY "AIza..."
```

---

## 4. GitHub Copilot CLI

AI coding agent by GitHub. Requires a Copilot Pro, Pro+, Business, or Enterprise subscription.

### Prerequisites

- Node.js 22+
- PowerShell 6+ on Windows (the default Windows PowerShell 5.1 is **not** supported — install PowerShell 7 from https://aka.ms/powershell)

### Install

| Platform | Command |
|----------|---------|
| **npm** (all platforms) | `npm install -g @github/copilot` |
| **WinGet** (Windows) | `winget install GitHub.Copilot` |
| **Install script** (macOS/Linux) | `curl -fsSL https://gh.io/copilot-install \| bash` |

### Post-install

```
copilot           # start interactive session
```

### Auth

On first launch, use the `/login` command and follow the browser prompts. Or set a personal access token:

```powershell
# PowerShell
$env:GH_TOKEN="ghp_..."
```

```cmd
# Command Prompt
set GH_TOKEN=ghp_...
```

---

## 5. Amazon Q Developer CLI

AI assistant by AWS. Free tier: 50 agentic interactions/month.

### Install

| Platform | Command |
|----------|---------|
| **macOS (Homebrew)** | See [AWS docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-installing.html) |
| **macOS (DMG)** | Download from [AWS](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-installing.html) |
| **Linux / WSL** | See below |

### Linux / WSL install

```bash
curl --proto '=https' --tlsv1.2 -sSf \
  "https://desktop-release.q.us-east-1.amazonaws.com/latest/q-x86_64-linux.zip" -o "q.zip"
unzip q.zip
./q/install.sh
```

### Windows

Not natively supported on Windows. Use WSL:

```powershell
# PowerShell (admin) — install WSL if needed
wsl --install
```

Then run the Linux install commands inside WSL.

### Post-install

```bash
q doctor          # check setup
q login           # authenticate
q chat            # start interactive session
```

---

## 6. Aider

Open-source AI pair programming tool. Works with Claude, GPT, Gemini, DeepSeek, and local models.

### Install (Python required)

| Method | Command |
|--------|---------|
| **Recommended** | `python -m pip install aider-install && aider-install` |
| **pip** | `python -m pip install -U aider-chat` |
| **pipx** | `pipx install aider-chat` |
| **uv** | `uv tool install --python python3.12 aider-chat@latest` |

### Windows (PowerShell / Command Prompt)

```
python -m pip install aider-install
aider-install
```

Requires Python 3.9–3.12 (Python 3.13 is not supported — the installer handles this automatically).

### Post-install

```bash
cd /path/to/your/project
aider --model sonnet --api-key anthropic=sk-ant-...
aider --model o3-mini --api-key openai=sk-...
aider --model deepseek --api-key deepseek=...
```

---

## Quick Reference

| Tool | Install Command | Auth |
|------|----------------|------|
| **Claude Code** | `irm https://claude.ai/install.ps1 \| iex` | Anthropic API key or browser login |
| **OpenAI Codex** | `npm install -g @openai/codex` | ChatGPT subscription or API key |
| **Gemini CLI** | `npm install -g @google/gemini-cli` | Google login (free) or API key |
| **Copilot CLI** | `npm install -g @github/copilot` | GitHub Copilot subscription |
| **Amazon Q** | WSL + curl installer | AWS Builder ID (free) |
| **Aider** | `pip install aider-install && aider-install` | Bring your own API key |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `command not found` after install | Close and reopen your terminal, or add the install path to your `PATH` |
| npm permission errors (Windows) | Run PowerShell/CMD as Administrator |
| npm permission errors (macOS/Linux) | Use `mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to `PATH` |
| PowerShell execution policy blocks scripts | Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` |
| Node.js not found | Install Node.js 22 LTS from https://nodejs.org or via `winget install OpenJS.NodeJS.LTS` |
| WSL not installed (Windows) | Run `wsl --install` in admin PowerShell, then restart |
