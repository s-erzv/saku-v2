import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const appOrigin = process.env.SAKU_EXTENSION_APP_ORIGIN

if (!appOrigin) {
  throw new Error("SAKU_EXTENSION_APP_ORIGIN is required, for example https://app.saku.example")
}

const appUrl = new URL(appOrigin)
if (appUrl.protocol !== "https:") {
  throw new Error("SAKU_EXTENSION_APP_ORIGIN must use HTTPS because Side Panel sessions require Secure cookies")
}

const origin = appUrl.origin
const dist = resolve(here, "dist")
const iconDir = resolve(dist, "icons")

await rm(dist, { recursive: true, force: true })
await mkdir(iconDir, { recursive: true })
await copyFile(resolve(here, "..", "public", "icons", "saku-mark.png"), resolve(iconDir, "saku-mark.png"))

const manifest = {
  manifest_version: 3,
  name: "Saku",
  version: "0.1.0",
  description: "Saku wallet extension.",
  icons: { 128: "icons/saku-mark.png" },
  action: {
    default_title: "Open Saku",
    default_icon: { 128: "icons/saku-mark.png" },
  },
  minimum_chrome_version: "114",
  permissions: ["sidePanel"],
  side_panel: { default_path: "sidepanel.html" },
  background: { service_worker: "background.js" },
  content_security_policy: {
    extension_pages: `script-src 'self'; object-src 'self'; frame-src ${origin}`,
  },
}

const background = `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
`

const sidePanel = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Saku</title>
    <style>
      html, body, iframe { width: 100%; height: 100%; margin: 0; border: 0; }
      body { overflow: hidden; background: #0B0B09; }
      iframe { display: block; }
    </style>
  </head>
  <body>
    <iframe src="${origin}/extension?surface=sidepanel" title="Saku wallet" allow="camera; clipboard-write"></iframe>
  </body>
</html>
`

await Promise.all([
  writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(resolve(dist, "background.js"), background),
  writeFile(resolve(dist, "sidepanel.html"), sidePanel),
])

console.log(`Built Saku extension for ${origin}`)
