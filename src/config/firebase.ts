import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";
import { clientEnv, isClientFirebaseConfigured } from "./env";

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firebaseDb: Database | null = null;

if (typeof window !== "undefined" && isClientFirebaseConfigured()) {
  try {
    firebaseApp = getApps().length > 0 ? getApp() : initializeApp({
      apiKey: clientEnv.FIREBASE_API_KEY,
      authDomain: clientEnv.FIREBASE_AUTH_DOMAIN,
      databaseURL: clientEnv.FIREBASE_DATABASE_URL,
      projectId: clientEnv.FIREBASE_PROJECT_ID,
      storageBucket: clientEnv.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: clientEnv.FIREBASE_MESSAGING_SENDER_ID,
      appId: clientEnv.FIREBASE_APP_ID,
      measurementId: clientEnv.FIREBASE_MEASUREMENT_ID,
    });
    firebaseAuth = getAuth(firebaseApp);
    firebaseDb = getDatabase(firebaseApp);
  } catch (err) {
    console.error("Failed to initialize Firebase Client SDK:", err);
  }
}

export { firebaseApp, firebaseAuth, firebaseDb };

export function getClientAuth(): Auth {
  if (!firebaseAuth) {
    throw new Error("Firebase Authentication is not initialized or configuration is missing.");
  }
  return firebaseAuth;
}

export function getClientDatabase(): Database {
  if (!firebaseDb) {
    throw new Error("Firebase Realtime Database is not initialized or configuration is missing.");
  }
  return firebaseDb;
}
