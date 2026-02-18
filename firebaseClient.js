const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

let initialized = false;

function initFirebase() {
  if (initialized) return admin;

  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  // Auto-detect common service account JSON files in project root if none provided
  let detectedPath = null;
  if (!serviceAccountPath && !serviceAccountJson) {
    try {
      const files = fs.readdirSync(__dirname);
      const candidates = files.filter((f) => {
        return (
          f.toLowerCase().endsWith('.json') &&
          (/firebase|adminsdk|service-account|serviceAccount|upworkbot|google-credentials|firebase-adminsdk/i.test(f))
        );
      });
      if (candidates.length > 0) {
        detectedPath = path.join(__dirname, candidates[0]);
        console.log(`ℹ️ Detected service account JSON at ${detectedPath}`);
      }
    } catch (e) {
      // ignore
    }
  }

  let credential = null;
  let serviceAccountObj = null;

  if (serviceAccountJson) {
    try {
      const obj = JSON.parse(serviceAccountJson);
      serviceAccountObj = obj;
      credential = admin.credential.cert(obj);
    } catch (e) {
      console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
      throw e;
    }
  } else if (serviceAccountPath) {
    const resolved = path.isAbsolute(serviceAccountPath)
      ? serviceAccountPath
      : path.join(__dirname, serviceAccountPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Service account file not found: ${resolved}`);
    }
    const obj = require(resolved);
    serviceAccountObj = obj;
    credential = admin.credential.cert(obj);
  } else {
    // If we detected a service account file earlier, use it
    if (detectedPath) {
      const obj = require(detectedPath);
      serviceAccountObj = obj;
      credential = admin.credential.cert(obj);
    } else {
      // Try application default
      credential = admin.credential.applicationDefault();
    }
  }

  const options = {};
  // If databaseURL not provided, try to derive from service account project_id
  if (databaseURL) {
    options.databaseURL = databaseURL;
  } else if (serviceAccountObj && serviceAccountObj.project_id) {
    // Common RTDB host patterns; user may need to adjust if they use a different host
    options.databaseURL = `https://${serviceAccountObj.project_id}.firebaseio.com`;
    console.log(`ℹ️ Derived databaseURL from service account: ${options.databaseURL}`);
  }

  try {
    admin.initializeApp({ credential, ...options });
    initialized = true;
    console.log('✅ Firebase Admin initialized');
  } catch (e) {
    if (e.message && e.message.includes('already exists')) {
      // already initialized in other module
      initialized = true;
    } else {
      throw e;
    }
  }

  return admin;
}

async function uploadJsonFileToRTDB(filePath, dbPath = '/eu_proposals') {
  if (!filePath) throw new Error('filePath is required');

  const admin = initFirebase();
  const db = admin.database();

  const content = fs.readFileSync(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error('Failed to parse JSON file: ' + e.message);
  }

  const ref = db.ref(dbPath).push();
  await ref.set({
    createdAt: new Date().toISOString(),
    sourceFile: path.basename(filePath),
    data,
  });

  console.log(`✅ Uploaded ${filePath} to Firebase RTDB at ${dbPath}/${ref.key}`);
  return { key: ref.key, path: `${dbPath}/${ref.key}` };
}

module.exports = {
  initFirebase,
  uploadJsonFileToRTDB,
};
