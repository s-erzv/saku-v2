/**
 * Someone's face, wherever this app names them.
 *
 * Transfers, contacts and requests all used to draw the same dark circle with two initials in
 * it, each writing its own copy, and none of them showed the picture the person had actually
 * uploaded — so a user who set an avatar saw it on their own profile and nowhere else, and every
 * counterparty in the app looked identical. This is the one place that decides what a person
 * looks like.
 *
 * Initials are the fallback rather than the default: a name gives two letters, and a contact
 * with no name at all gets the generic glyph rather than a blank disc.
 *
 * `referrerPolicy` is set because avatar URLs point at storage that does not need to know which
 * screen of the app someone is on.
 */

import { User } from "lucide-react"

interface ProfileAvatarProps {
  /** Uploaded picture, when the person is on Saku and set one. */
  src?: string | null
  /** Used for the initials, and for the alt text a screen reader reads. */
  name?: string | null
  /** Tailwind size classes for the disc, e.g. `w-10 h-10`. */
  className?: string
  /** Font size for the initials; give it one that fits the disc. */
  textClassName?: string
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export default function ProfileAvatar({
  src,
  name,
  className = "w-10 h-10",
  textClassName = "text-xs",
}: ProfileAvatarProps) {
  const trimmed = name?.trim()
  const letters = trimmed ? initials(trimmed) : null

  return (
    <span
      className={`${className} shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center text-white font-bold`}
    >
      {src ? (
        <img
          src={src}
          alt={trimmed ? `${trimmed}'s profile picture` : "Profile picture"}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      ) : letters ? (
        <span className={textClassName}>{letters}</span>
      ) : (
        <User className="w-1/2 h-1/2 opacity-70" />
      )}
    </span>
  )
}
