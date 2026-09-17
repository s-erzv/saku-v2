/** Chrome extension origins allowed to embed Saku in their Side Panel. */
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/

function extensionOrigins() {
  return (process.env.SAKU_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => EXTENSION_ORIGIN.test(origin))
}

/** CSP source list. With no configured extension, Saku remains unframeable. */
export function extensionFrameAncestors() {
  const origins = extensionOrigins()
  return origins.length > 0 ? origins.join(" ") : "'none'"
}

/** Session cookies use `SameSite=None` only for the approved embedded extension surface. */
export function isExtensionSurfaceRequest(request: Request) {
  return request.headers.get("x-saku-surface") === "extension" && extensionOrigins().length > 0
}
