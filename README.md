# Status Tag

A premium desktop application (Electron) to securely send animated status frames to your hardware display module via USB/serial.

## Overview

Status Tag transforms animated and static images into RGB565 frames and delivers them to your display module:

- **Hardware type**: Status Device (128x160 TFT)
- **Categorized Media Library**: Dynamic scanning of the `/designs` folder. Media is cleanly organized into `cartoons/`, `gifs/`, and `images/` dashboards. Supports `.gif`, `.png`, `.jpg`, and `.webp` formats.
- **Priority Sorting**: "Available" and "Busy" statuses are anchored at the top for quick access, with the rest sorted alphabetically.
- **Intelligent Auto-Revert Timers**: Set your active status to automatically revert to "Available" after 15m, 30m, 45m, or 1h. The application intelligently reverts to the *correct* "Available" state corresponding to your current dashboard (e.g., reverting to a cartoon if you are in the cartoon dashboard).
- **Hardware Control**: Command screen brightness and reset the hardware display directly from the sidebar.
- **Premium UI/UX**: Dark/Light mode toggle, sleek glassmorphism design, smooth transitions, custom dropdowns, and a frameless responsive layout.
- **Real-time Synchronization**: Instant detection of your Status device via USB, with real-time connection status badges and desktop notifications.

## Project Structure

- `main/` – Electron main process and IPC handlers.
- `renderer/` – Dashboard UI (HTML/JS/CSS).
- `services/` – `serialService.js` (Real-time frame processing and USB comms).
- `designs/` – The bundled media asset library, organized into `/cartoons`, `/gifs`, and `/images`.
- `DOCUMENTATION.txt` – Detailed project manual.

## Setup & Run

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Application**
   ```bash
   npm start
   ```

3. **Connect Hardware Module**
   - Connect your device via USB cable.
   - The app will detect it automatically and update the "Connection" badge.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Launch the Electron dashboard (development) |
| `npm run build-win` | Package the app into a Windows installer (`/dist`) |
| `npm run dist` | Full release pipeline for Windows systems |

### Versioning & Releases

To quickly bump the version of the application before building a release:

- **For small bug fixes:** (Changes `0.1.0` to `0.1.1`)
  ```bash
  npm version patch
  ```
- **For new features:** (Changes `0.1.0` to `0.2.0`)
  ```bash
  npm version minor
  ```
- **For huge overhauls:** (Changes `0.1.0` to `1.0.0`)
  ```bash
  npm version major
  ```

Once you run the command, it updates `package.json` for you. Then you just run `npm run dist` to create your updated `.exe`!

## Troubleshooting

- **Device not detected**: Ensure the USB cable is data-capable. Verify Windows Device Manager shows a COM port for the device.
- **Hardware Screen is Dark**: Check the Brightness slider in the left sidebar.

## Security Notes
- Strict Content Security Policy (CSP).
- Context Isolation enabled for secure backend access.
- Native Node APIs restricted to the main process.

---
© 2026 StoFo Technologies. All rights reserved.
