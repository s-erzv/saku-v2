# Saku browser extension

The extension opens Saku's first-party `/extension` route in Chrome's right Side Panel. The route has its own extension UI, but reuses the existing OTP cookie, APIs, MPC signer, and feature flows.

This is intentional: the session stays an `httpOnly`, partitioned cookie. The extension never receives or stores a bearer token, private key, seed phrase, or dApp provider capability.

Saku only permits configured Chrome extension IDs to frame it. Set `SAKU_EXTENSION_ORIGINS` on the Saku server to the comma-separated `chrome-extension://...` origins that should be allowed. This enables the embedded extension session while every other site remains excluded by CSP.

## Build

```bash
SAKU_EXTENSION_APP_ORIGIN=https://your-saku-host.example pnpm build:extension
```

For local development, run Next with its self-signed HTTPS certificate:

```bash
pnpm dev:https
SAKU_EXTENSION_APP_ORIGIN=https://localhost:3000 pnpm build:extension
```

Open `https://localhost:3000/extension` in Chrome once and accept the local certificate before opening the Side Panel.

Load `extension/dist` through Chrome's **Load unpacked** flow. Build production artifacts with the final HTTPS host; this value is embedded in the Side Panel and must point at a deployment serving `/extension`.

## Side Panel setup

1. Load the unpacked extension once, then copy its ID from `chrome://extensions`.
2. Add this server environment variable and restart Saku:

   ```bash
   SAKU_EXTENSION_ORIGINS=chrome-extension://YOUR_32_CHARACTER_EXTENSION_ID
   ```

3. Reload the extension on `chrome://extensions`.
4. Click the Saku toolbar icon. Chrome opens Saku in its Side Panel; users can pin it from Chrome's panel header.
