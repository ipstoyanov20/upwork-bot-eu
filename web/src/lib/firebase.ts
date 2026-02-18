import { FirebaseApp, getApps, initializeApp } from "firebase/app";
import { Database, getDatabase } from "firebase/database";

type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  databaseURL: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
};

function getFirebasePublicConfig(): FirebasePublicConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!apiKey || !authDomain || !projectId || !databaseURL || !appId) return null;

  return {
    apiKey,
    authDomain,
    projectId,
    databaseURL,
    appId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
}

export function getMissingFirebaseEnvVars(): string[] {
  // NOTE: In Next.js client components, env vars are inlined at build-time.
  // Dynamic access like `process.env[k]` won't be inlined reliably, so check
  // each variable explicitly.
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY)
    missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)
    missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
    missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL)
    missing.push("NEXT_PUBLIC_FIREBASE_DATABASE_URL");
  if (!process.env.NEXT_PUBLIC_FIREBASE_APP_ID)
    missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");
  return missing;
}

export const firebaseApp: FirebaseApp | null = (() => {
  const cfg = getFirebasePublicConfig();
  if (!cfg) return null;

  return getApps().length ? getApps()[0]! : initializeApp(cfg);
})();

export const rtdb: Database | null = firebaseApp ? getDatabase(firebaseApp) : null;
