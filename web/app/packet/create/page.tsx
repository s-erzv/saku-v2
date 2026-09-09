/**
 * Kept so existing links and bookmarks to the old create-only screen still land somewhere.
 * Creating is now one tab of `/packet`, alongside opening a packet and seeing your own.
 */

import { redirect } from "next/navigation"

export default function CreatePacketRedirect() {
  redirect("/packet?tab=create")
}
