# Assure CCTV Intelligence — Starter

A local-first starter for the Assure CCTV Intelligence admin dashboard.

## Included
- Next.js App Router + TypeScript dashboard scaffold
- Supabase browser/server client helpers
- SQL schema for centres, branch connectors, cameras, cabins, occupancy events, camera health and alerts
- Environment variable template
- A Python branch-connector placeholder (does not connect to cameras yet)

## Prerequisites
- Windows 10/11
- Node.js 20 LTS or newer
- Git (optional)
- A Supabase project

## 1. Install Node.js
Download the LTS version from https://nodejs.org/ and install it.
Open a NEW PowerShell window and check:

```powershell
node -v
npm -v
```

## 2. Create the Next.js app
Open PowerShell in this folder and run:

```powershell
npm install
```

## 3. Configure Supabase
In the Supabase project dashboard:
1. Open Project Settings → API.
2. Copy the Project URL.
3. Copy the publishable/anon key.
4. Create `.env.local` in this project root by copying `.env.example`.
5. Paste the URL and publishable key.

Do not put the `service_role` key in the browser or commit it to Git.

## 4. Create database tables
In Supabase, open SQL Editor → New query.
Copy the contents of `supabase/schema.sql` and run it.

The schema enables Row Level Security. For this starter, access is deliberately restricted: authenticated users can read the operational tables. Before production, create an explicit admin role/allowlist and policies, invite only approved admin users, and test every policy.

## 5. Run locally
```powershell
npm run dev
```
Open http://localhost:3000

## 6. Create your admin login
In Supabase → Authentication → Users, add/invite your admin user.
Then open the app and use the sign-in page.

## Important camera integration note
Hik-Connect cloud viewing does not automatically expose an AI-readable RTSP stream. This starter does not attempt to bypass Hik-Connect or expose camera ports publicly. First verify a direct stream from an authorised computer on the same branch LAN, or establish a secure VPN/subnet route. Only then implement the branch connector.

The Python connector is a safe placeholder. It reports its intended role but does not collect video or send credentials. Do not enter camera passwords into the web dashboard yet.

## First pilot details to confirm
- Which centre owns the pilot camera
- Confirmed camera IP and exact model
- Whether a Windows PC at that branch is online and remotely accessible
- Whether that PC can reach the camera's private IP on the local network
