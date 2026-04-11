# WhatsApp Blaster

A desktop app for sending personalized WhatsApp messages automatically via WhatsApp Web.
Built with **Electron**, **Node.js**, and **Puppeteer**.

---

## ✅ Features

- **CSV contact import** — bulk load contacts (name + phone with country code)
- **Template system** — `{name}`, `{phone}` placeholders
- **Image attachments** — send image with or without caption
- **Human-like delays** — configurable delay with ±20% jitter
- **Session persistence** — scan QR only once; session saved locally
- **Pause / Resume / Stop** — full runtime control
- **Live status table** — per-contact sent / failed / pending
- **Activity log** — real-time message log
- **Report export** — export CSV report after sending
- **Resume mode** — skip already-sent contacts after interruption
- **Dark UI** — clean industrial dark theme

---

## 📦 Prerequisites

- **Node.js** 18+ (https://nodejs.org)
- **npm** 9+
- A WhatsApp account (to scan QR)

---

## 🚀 Installation

```bash
# 1. Clone / download and enter the project
cd whatsapp-blaster

# 2. Install dependencies
npm install

# 3. Start the app
npm start
```

On first run, Puppeteer will download a compatible Chromium binary (~150 MB).

---

## 🖥 Usage

### Step 1 — Contacts
1. Go to the **Contacts** tab
2. Click "Browse CSV" or drag-drop your CSV file
3. Format: `name,phone` — phone must include country code (no `+`)

```csv
name,phone
Alice,14155552671
Bob,919876543210
```

### Step 2 — Message
1. Go to the **Message** tab
2. Write your template — use `{name}` and `{phone}` as placeholders
3. Optionally attach an image
4. Set delay between sends (min 3s recommended)

### Step 3 — Send
1. Go to the **Send** tab
2. Review the summary
3. Click **Start Sending**
4. A Chromium window opens — **scan the QR code** on first use
5. After login, messages send automatically
6. Use Pause/Stop as needed

### Step 4 — Report
The **Report** tab shows per-contact status. Export as CSV anytime.

---

## 📁 Project Structure

```
whatsapp-blaster/
├── package.json
├── sample-contacts.csv
├── README.md
└── app/
    ├── main/
    │   ├── index.js        ← Electron main process
    │   └── preload.js      ← Secure context bridge
    ├── renderer/
    │   ├── index.html      ← UI layout
    │   ├── style.css       ← Dark theme styles
    │   └── app.js          ← UI logic
    ├── services/
    │   ├── csvService.js        ← CSV parsing + validation
    │   ├── templateService.js   ← Placeholder rendering
    │   ├── whatsappService.js   ← Puppeteer automation core
    │   └── automationService.js ← Send loop orchestration
    └── utils/
        ├── delay.js   ← Human-like timing utilities
        └── logger.js  ← Electron-log wrapper
```

---

## ⚙️ Configuration

| Setting | Default | Notes |
|---------|---------|-------|
| Delay   | 8s      | Min 3s; ±20% jitter applied |
| Retries | 2       | Per-contact retry on failure |
| Session | `userData/wa-session` | Persistent across restarts |
| Report  | `userData/report.json` | Auto-saved after each send |

userData location:
- **macOS**: `~/Library/Application Support/whatsapp-blaster/`
- **Windows**: `%APPDATA%\whatsapp-blaster\`
- **Linux**: `~/.config/whatsapp-blaster/`

---

## ⚠️ WhatsApp Usage Limits & Safety

> **Important**: This tool uses WhatsApp Web for personal/legitimate use only.

- WhatsApp may **temporarily or permanently ban** accounts that send bulk messages
- Keep delays **≥5 seconds** between messages to reduce detection risk
- WhatsApp's fair use limit is loosely ~250 messages/day for regular accounts
- Do **not** use for spam, unsolicited marketing, or illegal purposes
- Respect WhatsApp's [Terms of Service](https://www.whatsapp.com/legal/terms-of-service)

**All data stays local** — no external servers, no third-party APIs.

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| QR code not appearing | Wait 10–20s; WhatsApp Web may be slow to load |
| "Send button not found" | WhatsApp Web UI changed; update SELECTORS in `whatsappService.js` |
| Session expired | Delete `userData/wa-session` folder and re-scan QR |
| Puppeteer not downloading | Check internet connection; run `npx puppeteer browsers install chrome` |
| Messages not sending | Ensure phone numbers include full country code, no spaces or `+` |

---

## 📝 License

MIT — for personal and legitimate business use only.
