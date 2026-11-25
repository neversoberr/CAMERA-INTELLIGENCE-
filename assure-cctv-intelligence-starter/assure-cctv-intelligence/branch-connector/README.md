# Branch connector (pilot placeholder)

This directory is a placeholder for the Windows branch agent. It is not yet a camera integration.

The first connector release should:
1. Run as a Windows service under a dedicated least-privilege account.
2. Read camera stream settings from a protected local secrets file or Windows Credential Manager.
3. Connect outbound to the central API over TLS.
4. Send health heartbeat and occupancy metadata only.
5. Never expose RTSP/HTTP/SDK ports publicly.
6. Keep video processing local where possible and apply privacy/retention controls.

Do not deploy this placeholder as a production service.
