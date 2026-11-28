# Framewatch desktop • Frigate recorder

**For a camera-site Windows 10/11 x64 PC with an existing Frigate installation.** Extract the complete [PC ZIP](../public/downloads/Framewatch-PC.zip), leave `Framewatch.html` next to `Framewatch.exe`, and run the EXE. It opens an Edge/Chrome app window (default browser as fallback). There is no Python, Go, Docker, cloud account or service to install on the PC. The unsigned launcher is built from this directory. Follow your site's software policy. This does not install, reconfigure or update Frigate.

## Connect and use

- Choose **Frigate**. Enter the **HTTPS dashboard address** you already use on this LAN, including its port or reverse-proxy mount prefix if applicable, and a native Frigate **viewer** username/password. Do not put credentials in the URL, Git, an environment file here, or chat. Port `8971` is Frigate's authenticated interface. SSO-only proxies without a native `/api/login` flow are not supported. Do not publish an unauthenticated NVR port to the internet.
- If your site uses a private CA, use the proper certificate hostname and OS trust store, or place its **public** PEM certificate in `frigate-ca.pem` alongside the EXE and relaunch. Private keys are neither required nor accepted for client auth. Certificate/hostname checks stay enabled. Redirects are not followed; use the final HTTPS address.
- **Cameras** lists the cameras visible in the account's stats, input and detection FPS. Selecting a camera requests a **snapshot**, which may be cached by Frigate if the camera is offline. **Watch live** opens a single receive-only WebRTC video peer. Named live streams use the camera’s configured `live.streams`; otherwise Framewatch tries its camera name. The PC needs a route to Frigate's advertised LAN WebRTC candidates (typically port 8555) and a compatible stream such as H.264. No mic, two-way talk or external STUN service is requested by Framewatch. Failed live video is not silently replaced by stills labelled live.
- **Detection timeline** shows up to the latest 60 authorised events. Filter within that window by camera/object or clips; **Review** shows the time, reported zones, available snapshot and seekable clip. Retention, recording settings, codec support and NVR permissions determine which media works. Framewatch does not start recording or change retention. No events is not evidence of vacancy.
- Inventory/events refresh every 15 seconds while the recorder workspace is visible, or on **Refresh**. Failed refreshes mark the last inventory stale and close media. On session expiry sign in again. Stop live view, switch workspace or hide the window to close/pause the live peer.
- **Monitor / Vacancy dashboard / Reminders** still use your explicitly shared iVMS window and its own detector. Switching to Frigate in the same app window does not disconnect an active screen share. Recorder events never trigger vacancy periods or reminders. The **sample recorder** is an illustrated tour, never a real connection.
- **Disconnect** drops the in-memory cookie jar and cancels upstream requests. **Quit desktop app** (power icon) closes the launcher and stops monitoring in that window. Alternatively stop video, close the launcher console and browser. Closing just a browser window leaves the process running until quit. Never share the temporary local app URL.

### Local boundary

The launcher binds **only** `127.0.0.1:48765` (stable browser origin for existing local monitor preferences). A random, per-launch path, exact Host/Origin checks, no CORS, frame denial, no-referrer and no-store protect the local API. Recorder credentials are submitted only to the chosen verified-TLS endpoint, not the hosted Framewatch site. Only fixed, viewer-facing operations are available. Media and live source names must match the authorised catalog. No upstream session cookie, full config, raw RTSP URL, identity attributes, or password is returned to the UI. There is **no generic proxy**. The authentication cookie exists only in process memory; disconnect forgets it rather than changing the recorder's own token lifetime. Only connect to recorders you trust on a trusted PC.

The **file-origin HTML** retains its network-denying content security policy and works without the EXE. The **hosted Next app** also offers the tour and PC download, but neither accepts a recorder password. Browser storage for an extracted file, the desktop loopback origin, and a hosted site is separate. Export old vacancy history before changing workflows; nothing is silently migrated.

### Upstream contract

Target: [Frigate v0.18.3](https://github.com/blakeblackshear/frigate/tree/v0.18.3). Uses the running HTTP API; no Frigate service or camera footage is redistributed.

| Operation | Upstream |
|---|---|
| Sign in | `POST /api/login` with `user` / `password`; retain Frigate's session cookie ([authentication](https://github.com/blakeblackshear/frigate/blob/v0.18.3/docs/docs/configuration/authentication.md)) |
| Inventory | `GET /api/stats`; optionally `GET /api/config` for allowed camera live aliases; keep only typed, relevant fields |
| Snapshot | `GET /api/{camera}/latest.jpg?height=480` |
| Video | `POST /api/go2rtc/webrtc?src={allowed-stream}`, JSON SDP offer/answer ([Frigate route](https://github.com/blakeblackshear/frigate/blob/v0.18.3/docker/main/rootfs/usr/local/nginx/conf/nginx.conf), [go2rtc signaling](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/internal/webrtc/server.go), [LAN live setup](https://github.com/blakeblackshear/frigate/blob/v0.18.3/docs/docs/configuration/live.md)) |
| Detections | `GET /api/events?limit=60&include_thumbnails=0&sort=date_desc` ([events](https://github.com/blakeblackshear/frigate/blob/v0.18.3/frigate/api/event.py)) |
| Evidence | `GET /api/events/{id}/snapshot.jpg` or `/clip.mp4` with optional single byte range ([media](https://github.com/blakeblackshear/frigate/blob/v0.18.3/frigate/api/media.py)) |

### Build / QA

From the app directory with Node 22.18+ and Go 1.24+ installed:

```sh
npm ci
npm run package:pc              # GO_BIN may point to a specific Go executable
(cd desktop && go test -race ./... && go vet ./...)
npm run test:desktop            # needs OpenSSL and Playwright Chromium
npm run test:pc                 # extracted offline HTML regression suite
```

Packaging cross-compiles Windows/amd64 with `CGO_ENABLED=0`, `-trimpath` and no external Go modules. The Windows executable and Go notices are shipped **inside** the PC ZIP. For native local debugging, build `go build -o <extracted-folder>/framewatch .` from this directory and run it with `-no-browser`. `-port 0` selects an ephemeral loopback port for testing.

On Windows the integration test runs the shipped EXE; on other platforms it builds the same Go server for the test OS. It uses the **actual extracted UI**, a private HTTPS Frigate **contract fixture** and a second real Chromium WebRTC peer with synthetic pixels. It verifies cookie isolation, bad login, permissions/catalog filtering, real decoded video, JPEG, MP4 playback, refresh errors, expired sessions, disconnect and quit. The Linux QA run checks the Windows PE/x64 header; it is not a Windows GUI, field-camera, or real NVR installation test. The tiny test-only VP9 MP4 is synthetic (`ffmpeg -f lavfi -i testsrc2=size=320x180:rate=10 -t 1 -an -c:v libvpx-vp9 -b:v 80k -movflags +faststart pattern.mp4`).

**0.7 package check:** production build and TypeScript passed, as did the race-enabled Go tests, 23 monitor unit tests, 15 hosted browser tests, 6 offline-file tests, and the native-launcher desktop scenario on Linux/Chromium. That scenario also stopped/resumed the sender to check the fresh-frame indicator, started a separate iVMS-style screen share, and verified that quitting released it. The Windows x64 ZIP is 19,277,258 bytes; SHA-256 `43dff86cea734eb586a3ad073af5601dc2126840c6cae86949d0a5b6dcac8cb4`.
