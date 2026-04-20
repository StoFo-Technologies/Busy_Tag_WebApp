# Stofo Tag

A premium desktop application (Electron) to securely send animated status frames to your hardware display module via USB/serial.

## Overview

Stofo Tag transforms GIF status images into RGB565 frames and delivers them to your display tag:

- **Hardware type**: Stofo Tag Device (128x160 TFT)
- **Automatic Library**: Dynamic scanning of the `/gifs` folder—supports both `.gif` and `.GIF` formats.
- **Priority Sorting**: Puts "Online & Available" and "Busy" at the top, followed by an alphabetical grid.
- **Auto-Revert Timers**: Set statuses to revert to "Available" after 15m, 30m, 45m, or 1h.
- **Hardware Control**: Control screen brightness directly from the sidebar.
- **Premium UI**: Dark mode glassmorphism with smooth transitions and responsive layouts.
- **Background Integration**: Runs in the System Tray with quick-access controls.

## Project Structure

- `main/` – Electron main process, IPC handlers, and Tray management.
- `renderer/` – Dashboard UI (HTML/JS/CSS).
- `services/` – `serialService.js` (Real-time frame processing and USB comms).
- `gifs/` – The animation library. Just drop any `.gif` file here to include it.
- `DOCUMENTATION.txt` – Detailed project manual.

## Setup

```bash
npm install
npm start
```

## Commands

| Command | What it does |
|---|---|
| `npm start` | Launch the Electron dashboard (development) |
| `npm run build-win` | Package the app into a Windows installer (`/dist`) |
| `npm run dist` | Full release pipeline for Windows systems |

> **Pro Tip:** When you add a new GIF to the `/gifs` folder, just restart the app and it will automatically appear in the dashboard grid with a formatted label!



