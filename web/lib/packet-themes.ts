import { Baby, Cake, Coins, Crown, Gift, GraduationCap, Heart, PartyPopper, Sparkles, Star, Waves } from "lucide-react"

export interface PacketTheme {
  id: string
  name: string
  description: string
  colors: {
    primary: string
    secondary: string
    accent: string
    envelopeBg: string
    envelopeFlap: string
    seal: string
  }
  icon: any
  image?: string
}

export const PACKET_THEMES: PacketTheme[] = [
  {
    id: "blue",
    name: "Blue Packet",
    description: "Classic style",
    colors: {
      primary: "#1e88e5",
      secondary: "#90caf9",
      accent: "#0d47a1",
      envelopeBg: "linear-gradient(180deg, #42a5f5 0%, #1e88e5 50%, #1565c0 100%)",
      envelopeFlap: "linear-gradient(180deg, #64b5f6 0%, #42a5f5 100%)",
      seal: "#0d47a1"
    },
    icon: Gift,
    image: "/packet-blue.svg"
  },
  {
    id: "red-lunar",
    name: "Red Lunar",
    description: "Chinese New Year",
    colors: {
      primary: "#d32f2f",
      secondary: "#ffcdd2",
      accent: "#b71c1c",
      envelopeBg: "linear-gradient(180deg, #ef5350 0%, #e53935 50%, #c62828 100%)",
      envelopeFlap: "linear-gradient(180deg, #f44336 0%, #ef5350 100%)",
      seal: "#b71c1c"
    },
    icon: Sparkles,
    image: "/packet-lunar.svg"
  },
  {
    id: "green-education",
    name: "Green Education",
    description: "Graduation theme",
    colors: {
      primary: "#388e3c",
      secondary: "#c8e6c9",
      accent: "#1b5e20",
      envelopeBg: "linear-gradient(180deg, #66bb6a 0%, #4caf50 50%, #388e3c 100%)",
      envelopeFlap: "linear-gradient(180deg, #81c784 0%, #66bb6a 100%)",
      seal: "#2e7d32"
    },
    icon: GraduationCap,
    image: "/packet-graduation.svg"
  },
  {
    id: "yellow-birthday",
    name: "Yellow Birthday",
    description: "Celebration time",
    colors: {
      primary: "#fbc02d",
      secondary: "#fff9c4",
      accent: "#f57f17",
      envelopeBg: "linear-gradient(180deg, #ffeb3b 0%, #ffc107 50%, #ffb300 100%)",
      envelopeFlap: "linear-gradient(180deg, #fff176 0%, #ffeb3b 100%)",
      seal: "#f57f17"
    },
    icon: Cake,
    image: "/packet-birthday.svg"
  },
  {
    id: "pink-love",
    name: "Pink Love",
    description: "Share the love",
    colors: {
      primary: "#e91e63",
      secondary: "#f8bbd9",
      accent: "#ad1457",
      envelopeBg: "linear-gradient(180deg, #f48fb1 0%, #f06292 50%, #e91e63 100%)",
      envelopeFlap: "linear-gradient(180deg, #f8bbd9 0%, #f48fb1 100%)",
      seal: "#c2185b"
    },
    icon: Heart,
    image: "/packet-love.svg"
  },
  {
    id: "purple-special",
    name: "Purple Special",
    description: "Premium style",
    colors: {
      primary: "#7b1fa2",
      secondary: "#e1bee7",
      accent: "#4a148c",
      envelopeBg: "linear-gradient(180deg, #ba68c8 0%, #9c27b0 50%, #7b1fa2 100%)",
      envelopeFlap: "linear-gradient(180deg, #ce93d8 0%, #ba68c8 100%)",
      seal: "#6a1b9a"
    },
    icon: Star,
    image: "/packet-special.svg"
  }
  ,
  {
    id: "gold-thr",
    name: "Gold THR",
    description: "Festive bonus",
    colors: {
      primary: "#f59e0b",
      secondary: "#fde68a",
      accent: "#b45309",
      envelopeBg: "linear-gradient(180deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)",
      envelopeFlap: "linear-gradient(180deg, #fcd34d 0%, #fbbf24 100%)",
      seal: "#b45309"
    },
    icon: Coins
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Understated",
    colors: {
      primary: "#1f2937",
      secondary: "#9ca3af",
      accent: "#030712",
      envelopeBg: "linear-gradient(180deg, #374151 0%, #1f2937 50%, #111827 100%)",
      envelopeFlap: "linear-gradient(180deg, #4b5563 0%, #374151 100%)",
      seal: "#f59e0b"
    },
    icon: Crown
  },
  {
    id: "teal-ocean",
    name: "Teal Ocean",
    description: "Calm and fresh",
    colors: {
      primary: "#0d9488",
      secondary: "#99f6e4",
      accent: "#134e4a",
      envelopeBg: "linear-gradient(180deg, #2dd4bf 0%, #14b8a6 50%, #0d9488 100%)",
      envelopeFlap: "linear-gradient(180deg, #5eead4 0%, #2dd4bf 100%)",
      seal: "#0f766e"
    },
    icon: Waves
  },
  {
    id: "baby-blue",
    name: "New Baby",
    description: "Newborn gift",
    colors: {
      primary: "#60a5fa",
      secondary: "#dbeafe",
      accent: "#1e40af",
      envelopeBg: "linear-gradient(180deg, #bfdbfe 0%, #93c5fd 50%, #60a5fa 100%)",
      envelopeFlap: "linear-gradient(180deg, #dbeafe 0%, #bfdbfe 100%)",
      seal: "#3b82f6"
    },
    icon: Baby
  },
  {
    id: "confetti",
    name: "Confetti",
    description: "Any celebration",
    colors: {
      primary: "#ec4899",
      secondary: "#fbcfe8",
      accent: "#831843",
      envelopeBg: "linear-gradient(140deg, #f472b6 0%, #a855f7 45%, #6366f1 100%)",
      envelopeFlap: "linear-gradient(140deg, #f9a8d4 0%, #c084fc 100%)",
      seal: "#a21caf"
    },
    icon: PartyPopper
  }
]

export function getPacketTheme(id: string): PacketTheme | undefined {
  return PACKET_THEMES.find(theme => theme.id === id)
}
