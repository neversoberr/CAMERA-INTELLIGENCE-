# Camera Intelligence

**Framewatch** reads a user-selected CCTV screen or screenshot and marks each camera view **Occupied**, **Empty** (no person detected), or **Unclear**. Analysis runs in the browser, with no camera passwords, database setup, or video uploads.

## Launch on your PC

Download [Framewatch-PC.zip](assure-cctv-intelligence-starter/assure-cctv-intelligence/public/downloads/Framewatch-PC.zip), choose **Extract All**, and double-click **Framewatch.html** in the extracted folder. Use a current desktop Edge or Chrome browser. Click **Share screen**, select the CCTV window, and match its grid. **Heavy** detection is on by default: two person models check every usable camera in every sweep. Choose **Balanced** or **Fast** for quicker detections. No installation, commands, internet connection or Arena access token are required.

## Watch the cameras move

Leave **Live video** selected to see the shared iVMS window as it plays. The browser requests 30 fps and displays the frames it receives, even during a Heavy scan. **Input ~… fps** measures the shared-window input, not how often a person is detected. Choose **Last scan** to inspect a still with matched boxes. Actual motion depends on the camera feed, iVMS, the browser and the PC.

## When was a cabin empty?

Open **Vacancy dashboard** in the same tab while sharing or afterwards. Use **Name places** to label cabins. Each row shows the first and last live empty check, duration and why the period ended. Filter by place, layout or date and export CSV. Stills and the sample never create history. Only local metadata is saved on this browser; there is no backfill for unmonitored hours.

## Notify me when a cabin is empty

With your CCTV screen shared, open **Reminders** and switch **Live vacancy reminders** on. Choose a cabin (or all cameras) and a delay. To also get a PC notification, click **Enable desktop notifications**, allow the browser prompt, and use **Test notification**. Each cabin alerts once per observed empty period, not on every scan. Keep Framewatch open and sharing; if desktop notifications are blocked you still get the in-app reminder.

## Run the web project from source

```sh
cd assure-cctv-intelligence-starter/assure-cctv-intelligence
npm ci
npm run dev
```

Use Node.js 22.18+, open http://localhost:3000, choose **Share screen** or **Open image**, and match the grid to your cameras. See the [app guide](assure-cctv-intelligence-starter/assure-cctv-intelligence/README.md) for details, testing, and the original registry starter.
