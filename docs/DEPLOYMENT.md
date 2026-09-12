# BMS NEXT — Deployment Guide & Environment Architecture

> **Target Platform:** Vercel (Production / Preview)  
> **Storage Provider:** Cloudflare R2 (Binary Object Storage only)  
> **Database & Auth:** Google Firebase (Realtime Database & Firebase Authentication)  
> **Build Command:** `npm run build` (`vite build`)  
> **Nitro Output:** `.vercel/output` (Vercel Serverless Functions)

---

## 1. Implementation & Verification Status

In accordance with PRD guidelines, verification statuses are strictly decoupled:

| Status Key | Value | Details |
|---|---|---|
| `CODE_IMPLEMENTED` | **COMPLETE** | Authoritative server environment module (`serverEnv.ts`), private key normalization, diagnostic status codes, singleton Firebase Admin SDK, diagnostic verification command, setup mode vs verified platform admin claim distinction in UI. |
| `EMULATOR_VERIFIED` | **COMPLETE** | All 10 Firebase Realtime Database emulator rules passing, including strict tenant isolation and 2-hour session rules (< 7200s allowed, > 7200s rejected). |
| `LOCAL_LIVE_VERIFIED` | **COMPLETE (LIVE VERIFIED)** | Live Firebase Admin SDK connection verified via `npm run verify:firebase-admin` (`FIREBASE_ADMIN_STATUS = READY`). Custom claim `{ platformAdmin: true }` successfully assigned to UID `BOkCLXp08tVmRHICTArgpReVh5Y2` via `npm run bootstrap:admin`. |
| `VERCEL_LIVE_VERIFIED` | **PENDING_VERCEL_ENV** | Production build compiles cleanly into `.vercel/output`. Live execution on Vercel requires configuring server-side environment variables in the Vercel Project Settings. |

---

## 2. Server-Only Environment Configuration

> [!CAUTION]
> Never prefix server secrets with `VITE_`.
> Any variable prefixed with `VITE_` is baked directly into client-side JavaScript bundles and visible to any browser user.

### 2.1 Server-Only Keys

Configure the following variables in Vercel under:  
**Vercel Dashboard → Project Settings → Environment Variables**  
(Select Production, Preview, and Development environments)

```bash
# Firebase Admin SDK (Server-only, trusted backend execution)
FIREBASE_ADMIN_PROJECT_ID=bmskh-6efb2
FIREBASE_ADMIN_CLIENT_EMAIL=your-service-account@bmskh-6efb2.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----"
FIREBASE_DATABASE_URL=https://bmskh-6efb2-default-rtdb.firebaseio.com

# Platform Administrator Bootstrap (Server-only)
INITIAL_PLATFORM_ADMIN_UID=BOkCLXp08tVmRHICTArgpReVh5Y2
INITIAL_PLATFORM_ADMIN_EMAIL=maaz@admin.com

# Cloudflare R2 Binary Storage (Server-only, binary attachments & documents)
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=your-bucket-name
R2_PUBLIC_BASE_URL=https://pub-your-id.r2.dev
```

### 2.2 Client-Exposed Keys (`VITE_` prefix required)

These are public client configuration parameters required by Firebase Web SDK:

```bash
VITE_FIREBASE_API_KEY=AIzaSyBMxknpEMWvDVh9k3rGLfxKDvHUVckLDwE
VITE_FIREBASE_AUTH_DOMAIN=bmskh-6efb2.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://bmskh-6efb2-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=bmskh-6efb2
VITE_FIREBASE_STORAGE_BUCKET=bmskh-6efb2.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=151369329582
VITE_FIREBASE_APP_ID=1:151369329582:web:c209f60698cb1c04abf63f
VITE_FIREBASE_MEASUREMENT_ID=G-7J9K596SH8
```

---

## 3. Local Development vs Serverless Runtime

### 3.1 Local Development
1. When modifying `.env`, always **fully restart** the local development server:
   ```bash
   # Terminate existing dev process (Ctrl+C)
   npm run dev
   ```
2. Run the diagnostic tool to check server configuration:
   ```bash
   npm run verify:firebase-admin
   ```
3. Once valid credentials are in `.env`, bootstrap the platform admin custom claim:
   ```bash
   npm run bootstrap:admin
   ```

### 3.2 Vercel Serverless Runtime
1. Local `.env` does **NOT** configure Vercel deployments.
2. After adding or updating variables in the Vercel Project Dashboard, trigger a **re-deployment** for the new environment values to take effect in server functions.
3. The server environment module (`src/server/config/serverEnv.ts`) evaluates `process.env` in serverless function invocations, verifies matching project IDs, normalizes private keys with escaped newlines (`\n`), and guards against client leakage.

---

## 4. Diagnostic & Bootstrap CLI Commands

| Command | Purpose |
|---|---|
| `npm run verify:firebase-admin` | Inspects environment variables, verifies private key format, checks Admin SDK initialization, Auth and RTDB reachability without leaking secrets. |
| `npm run bootstrap:admin` | Assigns `{ platformAdmin: true }` custom claim to the authoritative UID `BOkCLXp08tVmRHICTArgpReVh5Y2` while preserving all existing claims. |
| `npm test` | Runs the full 149-test suite covering accounting invariants, security rules, emulator tests, server config diagnostics, and platform admin access. |
| `npm run build` | Generates the production build for Vercel deployment with TanStack Start SSR error wrapper. |
