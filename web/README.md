# Web Viewer (Next.js) - Firebase RTDB `/eu_proposals`

This folder contains a Next.js (App Router) + TypeScript + Tailwind app that reads Firebase Realtime Database (RTDB) directly from the browser using the Firebase **client SDK**.

## What It Shows

- **Runs list** (route: `/`): latest runs under RTDB path `/eu_proposals`
- **Run detail** (route: `/runs/[runId]`): browse proposals inside a single run

In RTDB, each run is stored at:

`/eu_proposals/{pushId}`

With a shape like:

```ts
type EuProposalsRun = {
  createdAt: string;   // ISO string
  sourceFile: string;  // e.g. eu_proposals_extracted.json
  data: unknown;       // currently: array of proposal objects
}
```

## Setup

1. Install dependencies:

```bash
cd web
npm install
```

2. Create `web/.env.local`:

```bash
cd web
copy .env.local.example .env.local
```

Then fill in the values from Firebase Console -> Project settings -> Your apps (Web app).

Required:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

## Run

```bash
cd web
npm run dev
```

Open `http://localhost:3000`.

## Troubleshooting

- **Permission denied**
  - RTDB rules must allow read access (at least on `/eu_proposals`) for the client SDK.
- **Empty runs list**
  - Confirm your `NEXT_PUBLIC_FIREBASE_DATABASE_URL` points to the correct database.
  - Confirm `/eu_proposals` has data (the uploader pushes runs to that path).
- **Env vars not picked up**
  - Restart `npm run dev` after editing `.env.local`.

