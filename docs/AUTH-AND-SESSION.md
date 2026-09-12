# Authentication & session

The app is single-user and fully local — there is no auth server. Credentials
are fixed in `src/lib/session.ts`:

```
email:    admin@business.local
password: Admin@123
```

## Session

- Key: `bms_session_v1` in `localStorage`, value `{ email, expiresAt }`.
- TTL: **24 hours**. `getSession()` deletes an expired session and returns
  `null`, so expiry is enforced on every read as well as by a timer.
- `login()`, `logout()`, `getSession()`, `isAuthenticated()` are the whole API.

## Route protection

`src/routes/_app.tsx` is the private layout for every business screen. It checks
the session **before** rendering children, so unauthenticated users see the
login page immediately with no dashboard flash, and are redirected the moment
the 24-hour window ends — even mid-session. Logging out clears the key and
returns to `/login`.

Public routes: `/login`, `/about`, `/contact`. They use `PublicShell`, which
shows the BMS logo, contact details and the "Built by Mohammed Maaz — MMA"
footer without requiring a login.

## Sign-in experience

The button shows an inline spinner, then a full-screen “Entering your
workspace…” overlay with the logo plays before routing into the app.

## Security note

This gate protects a personal device, not a server. All data sits unencrypted in
IndexedDB. Anyone with access to the unlocked device and browser profile can
read it, so device-level security plus regular JSON backups are the real
protection.
