import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import admin from "firebase-admin";

const envPath = resolve(process.cwd(), ".env");
const env = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = match[2] || "";
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[match[1]] = val;
  }
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_ADMIN_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
  databaseURL: env.FIREBASE_DATABASE_URL || env.VITE_FIREBASE_DATABASE_URL,
});

const db = admin.database();
const recSnap = await db.ref("companyData/comp_1789194549079_1wz2v/receipts/mu33vn3wwrzciol8").once("value");
console.log("Receipt 2:", JSON.stringify(recSnap.val(), null, 2));
process.exit(0);
