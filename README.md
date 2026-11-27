# Camera Intelligence

**Framewatch** reads a user-selected CCTV screen or screenshot and marks each camera view **Occupied**, **Empty** (no person detected), or **Unclear**. Analysis runs in the browser, with no camera passwords, database setup, or video uploads.

## Launch on your PC

Download [Framewatch-PC.zip](assure-cctv-intelligence-starter/assure-cctv-intelligence/public/downloads/Framewatch-PC.zip), choose **Extract All**, and double-click **Framewatch.html** in the extracted folder. Use a current desktop Edge or Chrome browser. Click **Share screen**, select the CCTV window, and match its grid. Start with **Balanced** detection; use **Detailed** for distant people or **Fast** for a slower PC. No installation, commands, internet connection or Arena access token are required.

## Run the web project from source

```sh
cd assure-cctv-intelligence-starter/assure-cctv-intelligence
npm ci
npm run dev
```

Use Node.js 22+, open http://localhost:3000, choose **Share screen** or **Open image**, and match the grid to your cameras. See the [app guide](assure-cctv-intelligence-starter/assure-cctv-intelligence/README.md) for details, testing, and the original registry starter.
