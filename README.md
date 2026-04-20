# Stofo Tag

A premium desktop application (Electron) to securely send animated status frames to your hardware display module via USB/serial.

## Overview

Stofo Tag transforms GIF status images into RGB565 frames and delivers them to your display tag:

- Hardware type: Stofo Tag Device
- Color depth: RGB565 (16-bit)
- Animate statuses like: Busy, Available, In A Call, etc.
- Auto-detects device serial connection
- **NEW**: Premium Dark Mode Glassmorphism UI
- **NEW**: Custom Text Overlays burnt onto active GIFs

- **NEW**: Auto-Revert Timers (15m, 30m, 1h)
- **NEW**: System Tray Background Integration
- **NEW**: Hardware Screen Brightness Control

## Project structure

- `main/` – Electron main process & tray logic
  - `main.js`
  - `preload.js`
- `renderer/` – UI Dashboard
  - `index.html`, `renderer.js`, `styles.css`
- `services/`
  - `serialService.js` (Comms & Jimp frame processor)
- `gifs/` – Default 14+ GIF files
- `DOCUMENTATION.txt` – Full user manual & docs

## Setup

```bash
npm install
npm start
```

## Commands

| Command | What it does |
|---|---|
| `npm start` | Launch the Electron dashboard (development) |
| `npm run preprocess` | Extract GIF frames from `/gifs` → convert to RGB565 `.bin` files in `/frames` |
| `npm run watch-ports` | Debug tool: polls & lists available COM ports every 2 seconds |
| `npm run build-win` | Build a Windows NSIS installer `.exe` → output in `/dist` |
| `npm run dist` | Full release pipeline: `preprocess` → `build-win` in one command |

> **Note:** Run `npm run preprocess` once after adding or changing any GIF files in `/gifs`, before building.


