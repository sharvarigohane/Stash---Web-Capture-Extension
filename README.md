# Stash – Smart Web Capture Chrome Extension

Capture web research and turn it into organized notes and actionable tasks, without leaving the page.

Select text on any website, save it with one click, and Stash keeps a link back to the original source. Triage everything later from a clean inbox.
<img width="505" height="715" alt="image" src="https://github.com/user-attachments/assets/f6d579ed-723a-4c48-ae53-7cd9ad317b49" />

<!-- Add 2-3 screenshots here (popup in light mode, dark mode, task view) -->
<!-- ![Stash popup – dark mode](screenshots/popup-dark.png) -->

## Features

- **Capture from anywhere:** select text on any page and save it through the right-click context menu
- **Source-linked notes:** every capture remembers the page it came from
- **Inbox:** review new captures in one place, then turn them into notes or tasks
- **Task management:** add due dates and track what needs to be done
- **Tags and search:** organize captures with tags and search across everything instantly
- **Light and dark themes:** responsive interface that follows your preference
- **Local-first storage:** all data stays in your browser using `chrome.storage.local`
- **JSON export:** back up all your data to a file

## Tech Stack

- JavaScript (vanilla, no frameworks)
- HTML and CSS
- Chrome Extension APIs (Manifest V3): context menus, `chrome.storage.local`, background service worker

## Installation

Stash isn't on the Chrome Web Store, so you load it manually:

1. Download or clone this repository:
   ```
   git clone https://github.com/sharvarigohane/stash-web-capture-extension.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the folder that contains `manifest.json`
5. Pin the Stash icon to your toolbar

## Usage

1. Select any text on a web page
2. Right-click and choose the Stash option to save it
3. Click the Stash icon to open your inbox
4. Turn captures into notes or tasks, add tags and due dates, and search whenever you need something
5. Use the export option to download a JSON backup of your data

## Project Structure

```
├── manifest.json      # Extension configuration (Manifest V3)
├── background.js      # Service worker: context menu and capture handling
├── popup.html         # Popup interface markup
├── popup.css          # Popup styles (light and dark themes)
├── popup.js           # Popup logic: inbox, notes, tasks, search, export
├── theme.js           # Light/dark theme handling
├── icons/             # Extension icons
└── HOW-IT-WORKS.md    # Detailed explanation of how the extension works
```

## Privacy

Stash is local-first. Your captures are stored only in your browser through `chrome.storage.local`. Nothing is sent to a server, and there are no accounts or tracking.

## Version

Current version: **2.10**

## Author

**Sharvari Gohane**
[LinkedIn](https://linkedin.com/in/sharvarigohane) · [GitHub](https://github.com/sharvarigohane)
