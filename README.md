# PomoDo.

A minimal, retro pomodoro timer that works directly on your Notion to-do database. Pick the task you're focusing on from your existing list, and PomoDo. writes back to Notion as you work: no copying tasks into a separate app, no switching windows mid-flow.

## Features

- **Focus, short break and long break**, each with its own palette and a circular reveal between them
- **Radio-dial timer**: a tick scale slides under a fixed needle as the session runs
- **Notion tasks in place**: pick a task to focus on, mark it done, or add a new one, all written straight to Notion
- **Pomodoro logging**: each finished focus session adds 1 to a Number property on the task
- **Status filtering**: hide tasks by status (e.g. Paused, Stalled), per database
- **Collapsible task panel** on wider screens (button in the header, or `T`)
- Works from phone to desktop; about 10 KB gzipped, no dependencies, no build step

## Setup

Requires Python 3.9+ (macOS includes it). Nothing to install.

1. Create an internal integration at [notion.so/profile/integrations](https://www.notion.so/profile/integrations) with read, update and insert content capabilities. Copy its secret.
2. In Notion, open your to-do database → **⋯** → **Connections** → add your integration.
3. Copy `.env.example` to `.env` and paste the secret after `NOTION_TOKEN=`.
4. Run:

   ```bash
   python3 server.py
   ```

5. Open http://localhost:4747.

Without a token, PomoDo. runs on built-in demo data, so you can try it first.

### What your database needs

- A **Status** (or checkbox) property, so PomoDo. knows which tasks are open and can mark them done.
- Optional: a **Number** property named **Pomodoros** to log completed sessions. Any Number property can be chosen in Settings.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Start / pause |
| R | Restart session |
| S | Skip to next session |
| T | Show / hide tasks |
| 1 2 3 | Focus / short / long |

## How it works

- `server.py` serves the app and forwards a short allow-list of Notion API calls, adding your token on the server side. It only accepts requests from this machine, so the token never reaches the browser.
- `public/` holds the whole interface: plain HTML, CSS and JavaScript.
- `mock.py` provides the demo data used when no token is set.
- Settings live in the browser's local storage.
