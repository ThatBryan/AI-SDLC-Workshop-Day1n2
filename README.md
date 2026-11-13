# Complete Setup Guide: Todo App Development with GitHub Copilot

This walkthrough will guide you from zero to running the Todo App with GitHub Copilot assistance.

## Implemented status — PRP11 auth scaffold

**Last updated: 2026-11-13.** Implemented: passkey registration/login, seven-day revocable sessions, logout, protected routes, and additional-passkey enrollment after verifying an existing passkey. `/` (todos) and `/calendar` are **protected placeholders**, not working todo/calendar features. Other feature documentation and workshop checklists describe **target features, not shipped functionality**.

### Quick start (Windows PowerShell, Node.js >=22.13.0)

From the repository directory:

```powershell
npm install
Copy-Item .env.example .env.local
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Paste the generated value into `SESSION_SECRET=` in `.env.local`; keep it private and never commit it. Leave `RP_NAME=Todo App`, `RP_ID=localhost`, `RP_ORIGIN=http://localhost:3000`, and `DATABASE_PATH=todos.db` for development, then:

```powershell
npm run dev
```

Open **http://localhost:3000/login** in a passkey-capable browser. Use that exact origin (not `127.0.0.1`); if changing ports, change `RP_ORIGIN` too.

**Production:** use HTTPS and your actual public hostname, for example `RP_ID=todo.example.com`, `RP_ORIGIN=https://todo.example.com`, `RP_NAME=Todo App`. RP ID has no scheme/port/path; RP origin is the exact browser origin, with no path or trailing slash (include a non-default port if used). The origin hostname must equal RP ID or be its subdomain. HTTP localhost is development-only; production cookies are Secure. Supply a private generated `SESSION_SECRET` and set `DATABASE_PATH` to a writable persistent location on a **single host**; SQLite is not suitable for ephemeral serverless storage or independent multi-host replicas.

**Deployment blocker:** rate limiting is explicitly deferred by PRP11. Add trusted-edge throttling before public deployment.

### Validation scripts

| Command | Manifest script |
|---------|-----------------|
| `npm test` | Unit tests: `vitest run` |
| `npm run test:coverage` | `vitest run --coverage` |
| `npm run test:e2e` | `playwright test` |
| `npm run build` | `next build` |
| `npm run lint` | `eslint .` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm start` | `next start` (after build, with production config) |

Playwright uses Chromium, a separate dev server on localhost:3100, and a per-run temporary SQLite database. Browser installation may be needed (`npx playwright install chromium`).

PRP11 validation: 100 unit/integration tests and 14 Chromium E2E tests passed, along with lint, typecheck, and production build. Unit/integration coverage is 96.11% lines and 83.09% branches. Counterless authenticator behavior is tested with genuinely signed assertions; Chromium virtual authenticators cover incrementing/stale counters and two-device enrollment. Real device prompts and their timing still need manual acceptance testing.

---

## Table of Contents
1. [Install Visual Studio Code](#1-install-visual-studio-code)
2. [Install GitHub Copilot](#2-install-github-copilot)
3. [Install Node.js](#3-install-nodejs)
4. [Clone and Setup Todo App](#4-clone-and-setup-todo-app)
5. [Run the Application](#5-run-the-application)
6. [Use GitHub Copilot with PRPs](#6-use-github-copilot-with-prps)
7. [Verify Core Features](#7-verify-core-features)
8. [Troubleshooting](#troubleshooting)

---

## 1. Install Visual Studio Code

### Windows
1. Visit https://code.visualstudio.com/
2. Click **"Download for Windows"**
3. Run the downloaded installer (`VSCodeSetup-x64-*.exe`)
4. Follow installation wizard:
   - ✅ Accept license agreement
   - ✅ Check "Add to PATH" option
   - ✅ Check "Create a desktop icon" (optional)
   - ✅ Check "Register Code as an editor for supported file types"
5. Click **"Install"**
6. Launch VS Code after installation

### macOS
1. Visit https://code.visualstudio.com/
2. Click **"Download for Mac"**
3. Open the downloaded `.zip` file
4. Drag **Visual Studio Code.app** to Applications folder
5. Launch from Applications or Spotlight (Cmd+Space, type "Visual Studio Code")

### Linux (Ubuntu/Debian)
```bash
# Update package index
sudo apt update

# Install dependencies
sudo apt install software-properties-common apt-transport-https wget

# Import Microsoft GPG key
wget -q https://packages.microsoft.com/keys/microsoft.asc -O- | sudo apt-key add -

# Add VS Code repository
sudo add-apt-repository "deb [arch=amd64] https://packages.microsoft.com/repos/vscode stable main"

# Install VS Code
sudo apt update
sudo apt install code

# Launch VS Code
code
```

### Verify Installation
Open terminal/command prompt and run:
```bash
code --version
```
You should see version information like:
```
1.95.0
912bb683695358a54ae0c670461738984cbb5b95
x64
```

---

## 2. Install GitHub Copilot

### Prerequisites
- GitHub account (create at https://github.com if needed)
- GitHub Copilot subscription (free trial available)

### Step 1: Enable GitHub Copilot for Your Account
1. Visit https://github.com/settings/copilot
2. Click **"Start free trial"** or **"Get access to GitHub Copilot"**
3. Choose plan:
   - **Individual**: $10/month (30-day free trial)
   - **Business**: $19/user/month
   - **Free for students**: Apply at https://education.github.com/
4. Complete payment setup (if applicable)
5. Enable Copilot for your account

### Step 2: Install Copilot Extension in VS Code
1. Open **Visual Studio Code**
2. Click **Extensions** icon in sidebar (or press `Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"GitHub Copilot"**
4. Find extension by **GitHub** (verified publisher)
5. Click **"Install"**
6. Also install **"GitHub Copilot Chat"** extension (for chat functionality)

### Step 3: Sign in to GitHub
1. After installation, VS Code will prompt to sign in
2. Click **"Sign in to GitHub"**
3. Browser opens → Click **"Authorize Visual Studio Code"**
4. Return to VS Code
5. Bottom right should show "GitHub Copilot: Ready" status

### Verify Copilot Installation
1. Create a new file: `test.js`
2. Type: `// function to add two numbers`
3. Press `Enter`
4. Copilot should suggest a function (shown in gray text)
5. Press `Tab` to accept suggestion

If you see suggestions, Copilot is working! ✅

---

## 3. Install Node.js

The Todo App requires **Node.js >=22.13.0** and **npm**.

### Windows
1. Visit https://nodejs.org/
2. Download **"LTS"** version (recommended)
3. Run a Node.js installer for version 22.13.0 or newer
4. Follow wizard:
   - ✅ Accept license
   - ✅ Keep default installation path
   - ✅ Install npm package manager
   - ✅ Install necessary tools (check box for native modules)
5. Click **"Finish"**

### macOS
**Option 1: Official Installer**
1. Visit https://nodejs.org/
2. Download **"LTS"** version
3. Open `.pkg` file and follow installer

**Option 2: Using Homebrew**
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@22

# Verify
node --version
npm --version
```

### Linux (Ubuntu/Debian)
```bash
# Install Node.js 22.x (22.13.0 or newer)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Verify Node.js Installation
Open terminal and run:
```bash
node --version  # Must be v22.13.0 or higher
npm --version
```

---

## 4. Clone and Setup Todo App

### Option A: Clone from Git (if using version control)
```bash
# Navigate to your projects folder
cd ~/Projects  # or C:\Projects on Windows

# Clone repository (replace with actual repo URL)
git clone <your-repo-url> todo-app
cd todo-app
```

### Option B: Setup Existing Project
If you already have the project folder:
```bash
# Navigate to project directory
cd /path/to/todo-app
```

### Install Dependencies and Configure Authentication
Follow the [Windows quick start](#quick-start-windows-powershell-nodejs-22130) above, including the environment-file copy and secret generation **before** starting the server.

### Project Structure Verification
Ensure you have these key files:
```
todo-app/
├── PRPs/
│   └── 11-authentication-webauthn.md
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   └── api/
├── lib/
│   ├── db.ts
│   ├── auth.ts
│   ├── webauthn.ts
│   └── timezone.ts
├── proxy.ts                     ← Next.js 16 route protection
├── .env.example
├── package.json
├── next.config.ts
└── README.md
```

---

## 5. Run the Application

### Start Development Server
```bash
npm run dev
```

The development server uses `.env.local`. Keep port 3000 available so its browser origin matches the development RP configuration.

### Access the Application
1. Open browser
2. Navigate to: **http://localhost:3000**
3. You should see the **Login** page

### First-Time Setup
1. **Register a new account**:
   - Enter username (e.g., "testuser")
   - Click "Register"
   - Follow WebAuthn prompt (use fingerprint/face ID/PIN)
   
2. **Explore the authenticated scaffold**:
   - Confirm your username appears on the protected placeholder page.
   - Use **Add passkey**, verify an existing passkey, then separately click **Save new passkey** and finish within two minutes.
   - Todo creation and calendar functionality are not implemented yet.

### Stop the Server
Press `Ctrl+C` in the terminal running `npm run dev`

---

## 6. Use GitHub Copilot with PRPs

Now that everything is installed, let's use Copilot with the Product Requirement Prompts!

### Step 1: Open Project in VS Code
```bash
# From project directory
code .
```

### Step 2: Verify Copilot Instructions Loaded
1. Open **GitHub Copilot Chat** (Ctrl+Alt+I / Cmd+Alt+I)
2. Type: `What timezone should I use for date operations?`
3. Copilot should mention **Singapore timezone** and reference `lib/timezone.ts`
   - If it does, the instructions are working! ✅

### Step 3: Reference PRPs in Chat

#### Example 1: Ask About Features
```
@workspace What are the acceptance criteria for the recurring todos feature?
```

Use the feature requirements in `PRPs/` as the target specification, for example:
- Can create recurring todo with pattern
- Completing recurring todo creates next instance
- Next instance has correct due date
- etc.

#### Example 2: Implement New Feature
```
Using the PRP for the tag system, help me add a new color picker for tag creation
```

Copilot will:
1. Read PRP section on tags
2. Understand technical constraints (hex colors, unique names)
3. Suggest implementation following project patterns

#### Example 3: Debug Using PRPs
```
I'm getting an error with recurring todos. Check the PRP requirements and help me fix it.
```

Copilot will:
1. Review recurring todo specifications
2. Check your code against PRP constraints
3. Suggest fixes aligned with requirements

### Step 4: Use Copilot Inline Suggestions

**Scenario**: Add a new API route for todo statistics

1. Create file: `app/api/stats/route.ts`
2. Type comment:
   ```typescript
   // GET endpoint to return todo statistics following project auth pattern
   ```
3. Press Enter
4. Copilot suggests code following:
   - Session authentication pattern
   - Singapore timezone handling
   - Database query structure from `lib/db.ts`
5. Press `Tab` to accept suggestions

### Step 5: Ask Copilot to Generate Code from PRP

Open Copilot Chat and try:
```
Using the PRP for export/import feature, generate the import validation logic
```

Copilot will create code that:
- Validates JSON structure
- Checks required fields (todos, subtasks, tags)
- Handles ID remapping
- Preserves relationships

---

## 7. Verify Core Features

Authentication below is a manual verification checklist, **not a recorded pass**. All remaining checklists in this section are **future acceptance targets**, unavailable in the current scaffold.

### Authentication — manual checks
```bash
# Open http://localhost:3000/login
1. Register with username: "copilot-test-user"
2. Verify WebAuthn prompt appears
3. Complete registration
4. Logout and login again
5. Verify session persists after page reload
```

### Planned: Todo CRUD
```
1. Create todo: "Buy groceries"
2. Set priority: High
3. Set due date: Tomorrow 2:00 PM
4. Edit todo title to: "Buy groceries and cook"
5. Toggle completion checkbox
6. Delete todo
```

### Planned: Recurring Todos
```
1. Create todo: "Daily standup"
2. Check "Repeat" checkbox
3. Select "Daily" pattern
4. Set due date: Tomorrow 9:00 AM
5. Complete the todo
6. Verify new instance created for next day
```

### Planned: Subtasks
```
1. Create todo: "Prepare presentation"
2. Click to expand subtasks
3. Add subtask: "Create slides"
4. Add subtask: "Rehearse speech"
5. Check first subtask
6. Verify progress shows "1/2 completed (50%)"
```

### Planned: Tags
```
1. Click "Manage Tags" button
2. Create tag: "work" (color: #3B82F6)
3. Create tag: "urgent" (color: #EF4444)
4. Assign both tags to a todo
5. Filter by "work" tag
6. Verify only tagged todos shown
```

### Planned: Templates
```
1. Create todo with desired settings
2. Click "Save as Template"
3. Enter name: "Meeting Task"
4. Add subtasks before saving
5. Later, click "Use Template"
6. Verify new todo created with all settings
```

### Planned: Reminders
```
1. Click "Enable Notifications" (grant permission)
2. Create todo with due date in 20 minutes
3. Set reminder: "15 minutes before"
4. Wait 5 minutes
5. Browser notification should appear
```

### Planned: Calendar View
```
1. Navigate to http://localhost:3000/calendar
2. Verify current month displayed
3. Create todos with different due dates
4. Verify todos appear on correct calendar cells
5. Click prev/next month buttons
```

### Planned: Search & Filter
```
1. Create multiple todos
2. Type in search box: "meeting"
3. Verify filtered results
4. Select priority filter: "High"
5. Verify combined filters work
```

### Planned: Export/Import
```
1. Create several todos with tags and subtasks
2. Click "Export Todos"
3. Verify JSON file downloads
4. Delete all todos
5. Click "Import Todos" and select file
6. Verify todos restored with all metadata
```

---

## Troubleshooting

### Copilot Not Working

**Problem**: No suggestions appearing

**Solutions**:
1. Check Copilot status bar (bottom right)
   - Should say "GitHub Copilot: Ready"
2. Sign out and sign in again:
   - Click Accounts icon (bottom left)
   - Sign out of GitHub
   - Sign in again
3. Restart VS Code
4. Check subscription at https://github.com/settings/copilot

**Problem**: Copilot ignoring instructions

**Solutions**:
1. Verify `.github/copilot-instructions.md` exists
2. Reload VS Code window (Ctrl+Shift+P → "Reload Window")
3. Use `@workspace` in chat for better context
4. Be specific: "Following the project's auth pattern..."

---

### Node.js / npm Issues

**Problem**: `npm install` fails

**Solutions**:
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Reinstall
npm install
```

**Problem**: Port 3000 already in use

**Solutions**:
```bash
# Option 1: Kill process on port 3000
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:3000 | xargs kill -9

# Option 2: Use different port
npm run dev -- -p 3001
```

For port 3001, first set `RP_ORIGIN=http://localhost:3001` in `.env.local` and restart.

---

### Database Issues

**Problem**: Database locked or corrupted

**Solutions**: Stop the server before maintenance and back up the SQLite database. Confirm `DATABASE_PATH` is writable and persistent. Do not delete it as a login fix: it stores accounts, passkeys, sessions, and challenges. Holiday seeding is not part of this scaffold.

---

### WebAuthn / Authentication Issues

**Problem**: WebAuthn not working in browser

**Solutions**:
1. Use supported browser:
   - ✅ Chrome/Edge (recommended)
   - ✅ Firefox
   - ✅ Safari
2. Enable HTTPS or use localhost (required for WebAuthn)
3. Check browser supports WebAuthn:
   - Visit: https://webauthn.io
   - Test if authentication works

**Problem**: Can't login after registration

**Solutions**:
1. Use the original username and a registered passkey on the configured origin.
2. Check `.env.local` RP settings and `SESSION_SECRET`, then restart after changes.
3. Retry cancelled/expired prompts; check browser console errors (F12). There is no recovery if all passkeys are lost; deleting the database does not recover an account.

---

### Playwright Testing Issues

**Problem**: Tests fail to run

**Solutions**:
```bash
# Install Playwright browsers
npx playwright install

# Run with headed mode to see what's happening
npx playwright test --headed

# Run specific test
npx playwright test tests/01-authentication.spec.ts
```

---

## Next Steps

Now that everything is set up, you can:

### 1. Explore with Copilot Chat
```
@workspace Show me how to add a new priority level called "urgent"
```

### 2. Implement New Features
```
Using the PRP format, help me add a "notes" field to todos
```

### 3. Fix Bugs
```
I'm getting undefined for authenticator.counter. Check the copilot instructions and fix it.
```

### 4. Run Tests
```bash
# Run unit tests, then browser E2E tests
npm test
npm run test:e2e

# View test report
npx playwright show-report
```

### 5. Build for Production
Configure production HTTPS, persistent storage, and trusted-edge throttling as described above before deployment.

```bash
# Create production build
npm run build

# Start production server
npm start
```

---

## Additional Resources

- **VS Code Docs**: https://code.visualstudio.com/docs
- **GitHub Copilot Docs**: https://docs.github.com/en/copilot
- **Next.js Docs**: https://nextjs.org/docs
- **Playwright Docs**: https://playwright.dev/
- **WebAuthn Guide**: https://webauthn.guide/

---

## Quick Reference Commands

```bash
# Development
npm run dev          # Start dev server
npm run build        # Production build
npm start            # Start production server
npm run lint         # Run ESLint
npm run typecheck    # TypeScript checks

# Testing
npm test                              # Unit tests
npm run test:coverage                 # Unit coverage
npm run test:e2e                      # Browser E2E tests
npx playwright test --ui              # Interactive mode
npx playwright test --headed          # See browser
npx playwright show-report            # View results

# Database
sqlite3 todos.db                       # Optional SQLite CLI inspection

# Copilot
Ctrl+Alt+I (Cmd+Alt+I)                # Open Copilot Chat
Ctrl+I (Cmd+I)                        # Inline Copilot
Tab                                    # Accept suggestion
Esc                                    # Dismiss suggestion
```

---

## Success Criteria

You've successfully completed setup when:

- ✅ VS Code installed and running
- ✅ GitHub Copilot active (shows suggestions)
- ✅ Copilot Chat responds with project-specific answers
- ✅ Todo app running on http://localhost:3000
- ✅ Can register/login with WebAuthn
- Confirm protected todo/calendar placeholders are displayed (task features come later)
- Run validation scripts above and review results after changes
- ✅ Copilot references PRPs when asked about features

---

**Congratulations!** 🎉 You're now ready to develop the Todo App with GitHub Copilot assistance.

For questions or issues, refer to the troubleshooting section or ask Copilot Chat:
```
@workspace I'm having trouble with [describe issue]
```
