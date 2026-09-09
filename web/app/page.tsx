"use client"

import { useEffect } from "react"
import AOS from "aos"
import "aos/dist/aos.css"
import { MotionConfig, motion, useScroll, useTransform } from "framer-motion"

import { ShieldCheck, Wallet, Zap } from "lucide-react"
import Navbar from "@/components/landing/Navbar"
import FAQSection from "@/components/landing/Faq"
import Slider from "@/components/landing/Slider"
import { ShaderBackground } from "@/components/ui/mesh-portfolio"
import { BouncyCardsFeatures } from "@/components/ui/bounce-card-features"

// Hamsters parked around the headline. They sit near the edges so the centred
// type stays clear, and they only appear once there is room for them.
const HERO_HAMSTERS = [
  { src: "/landing/card1.png", className: "hidden sm:block left-[1%] top-[26%] w-28 lg:w-40", drift: -70, tilt: -8 },
  { src: "/landing/card3.png", className: "hidden sm:block right-[1%] top-[20%] w-24 lg:w-36", drift: -110, tilt: 9 },
  { src: "/landing/card2.png", className: "left-[3%] bottom-[4%] w-20 sm:left-[6%] sm:bottom-[6%] sm:w-24 lg:w-32", drift: -40, tilt: 7 },
  { src: "/landing/card4.png", className: "right-[2%] bottom-[5%] w-20 sm:right-[5%] sm:bottom-[8%] sm:w-24 lg:w-32", drift: -90, tilt: -6 },
]

const HERO_BADGES = [
  { icon: ShieldCheck, label: "MPC-secured wallet" },
  { icon: Zap, label: "Settles in seconds" },
  { icon: Wallet, label: "No seed phrase" },
]

function HeroHamster({
  src,
  className,
  drift,
  tilt,
  index,
}: {
  src: string
  className: string
  drift: number
  tilt: number
  index: number
}) {
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, [0, 900], [0, drift])

  return (
    <motion.img
      src={src}
      alt=""
      style={{ y }}
      className={`pointer-events-none absolute z-0 drop-shadow-[0_12px_25px_rgba(0,0,0,0.12)] ${className}`}
      initial={{ opacity: 0, scale: 0.6, rotate: tilt * 2 }}
      animate={{ opacity: 1, scale: 1, rotate: tilt }}
      transition={{ delay: 0.25 + index * 0.12, type: "spring", stiffness: 90, damping: 12 }}
    />
  )
}

export default function Home() {
  useEffect(() => {
    AOS.init({ duration: 1000, once: true })
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <div className="w-full min-h-dvh overflow-x-hidden">
        {/* NAVBAR */}
        <div className="w-full flex justify-center">
          <Navbar className="fixed" />
        </div>

        {/* Hero Section */}
        <section className="relative flex min-h-[94svh] w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-primary via-amber-100 to-background px-6 pb-20 pt-40 text-center md:pt-44">
          <ShaderBackground className="absolute inset-0" />
          {/* Fades the shader into the page background instead of cutting it off. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-background" />

          {HERO_HAMSTERS.map((h, i) => (
            <HeroHamster key={h.src} {...h} index={i} />
          ))}

          <motion.h1
            className="relative z-10 px-2 text-6xl font-medium leading-none text-black/85 sm:text-7xl md:text-8xl lg:text-9xl"
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="whitespace-nowrap">
              Easy
              <video
                className="mx-2 inline w-16 align-middle sm:w-22 md:w-28 lg:w-44"
                src="/logo.webm"
                autoPlay
                muted
                loop
                playsInline
              />
            </span>
            Crypto
            <br />
            Transfers
          </motion.h1>

          <motion.p
            className="relative z-10 mt-6 max-w-md text-base text-black/50 md:text-xl"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            Send USDC to a phone number. No addresses, no seed phrase, no waiting.
          </motion.p>

          <motion.a
            href="/get-started"
            className="relative z-10 mt-8 inline-flex items-center rounded-full border border-black bg-gradient-to-r from-amber-300 to-primary px-8 py-4 text-lg font-medium shadow-xl md:px-12 md:py-5 md:text-xl"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.96 }}
          >
            <Wallet className="mr-2 h-6 w-6 md:h-7 md:w-7" />
            Try Saku Now!
          </motion.a>

          <motion.ul
            className="relative z-10 mt-10 flex flex-wrap items-center justify-center gap-2 md:gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.6 }}
          >
            {HERO_BADGES.map((badge, i) => {
              const Icon = badge.icon
              return (
                <motion.li
                  key={badge.label}
                  className="flex items-center gap-1.5 rounded-full border border-black/10 bg-white/60 px-3 py-1.5 text-xs font-semibold text-black/60 backdrop-blur-sm md:text-sm"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 3.4, delay: i * 0.4, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {badge.label}
                </motion.li>
              )
            })}
          </motion.ul>
        </section>

        {/* Promotion Section */}
        <section className="relative w-full flex flex-col gap-12 md:gap-20 py-10 justify-center items-start text-left md:items-center md:text-center px-6">
          <div className="flex flex-col max-w-4xl gap-4 md:gap-6">
            <h1 className="text-4xl sm:text-5xl md:text-[80px] text-black/85 font-medium leading-normal">
              Transfer crypto <br /> with phone number
            </h1>
            <p className="text-md md:text-2xl text-black/50">
              Easily transfer USDC without inputing the complex address
            </p>
          </div>

          <div className="w-full max-w-[1400px] md:px-10">
            <Slider />
          </div>
        </section>

        {/* Features Section */}
        <section className="relative w-full pt-20 md:pt-30">
          <BouncyCardsFeatures />
        </section>

        {/* FAQ Section */}
        <section
          className="relative w-full flex flex-col gap-20 py-20 justify-center items-start text-left md:items-center md:text-center pt-20 md:pt-30 px-6"
          data-aos="fade-down"
        >
          <FAQSection />
        </section>

        {/* CTA Section */}
        <section className="relative w-full overflow-hidden justify-center py-14 md:py-24 md:p-10 flex flex-col md:flex-row items-center gap-10 md:gap-40 bg-gradient-to-b from-background to-primary">
          {/* Coins rising behind the copy. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.span
                key={i}
                className="absolute h-4 w-4 rounded-full border-2 border-[#C97F1D] bg-gradient-to-br from-[#FFE08A] to-[#E9A21B]"
                style={{ left: `${10 + i * 19}%`, bottom: "-8%" }}
                animate={{ y: [0, -420], opacity: [0, 0.8, 0], rotate: [0, 140] }}
                transition={{ duration: 9 + i * 1.3, delay: i * 1.6, repeat: Infinity, ease: "easeOut" }}
              />
            ))}
          </div>

          <div className="relative z-10 flex flex-col gap-6 md:gap-10 text-left items-start px-6">
            <p className="text-lg md:text-2xl font-medium">
              Secure your transaction without wallet addresses. <br />
              <span className="bg-gradient-to-r from-amber-600 to-amber-800 bg-clip-text text-transparent">
                Try Saku and use your phone number instead.
              </span>
            </p>

            <motion.a
              className="w-fit px-8 md:px-12 py-3 md:py-4 bg-gradient-to-r from-amber-300 border border-black to-primary rounded-3xl shadow-2xl"
              href="/get-started"
              whileHover={{ scale: 1.05, y: -3 }}
              whileTap={{ scale: 0.95 }}
            >
              <Wallet className="inline mr-3" />
              Try Saku Now
            </motion.a>
          </div>

          <motion.img
            className="relative z-10 w-[190px] md:w-[260px]"
            src="/landing/cta.gif"
            alt=""
            animate={{ y: [0, -14, 0], rotate: [-2, 2, -2] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          />
        </section>

        {/* FOOTER */}
        <footer className="w-full bg-primary">
          <div className="max-w-7xl mx-auto px-8 py-10 flex flex-col gap-16">
            <div className="h-px bg-black/10" />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-12 text-left">
              <div className="flex flex-col gap-4">
                <h3 className="text-2xl font-semibold">
                  <img className="w-10 mr-3 inline" src="/logo.png" alt="" />
                  Saku
                </h3>
                <p className="text-black/60">
                  Secure crypto transfers using just your phone number.
                  Simple. Fast. Trusted.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="font-medium">Product</h4>
                <a className="text-black/60 hover:text-amber-600 transition cursor-pointer w-max">
                  Features
                </a>
                <a className="text-black/60 hover:text-amber-600 transition cursor-pointer w-max">
                  Security
                </a>
                <a className="text-black/60 hover:text-amber-600 transition cursor-pointer w-max">
                  Pricing
                </a>
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="font-medium">Company</h4>
                <a className="text-black/60 hover:text-amber-600 transition cursor-pointer w-max">
                  About
                </a>
                <a className="text-black/60 hover:text-amber-600 transition cursor-pointer w-max">
                  Blog
                </a>
                <a className="text-black/60 hover:text-amber-600 transition cursor-pointer w-max">
                  Contact
                </a>
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="font-medium">Connect</h4>
                <a className="text-black/60 hover:text-amber-600 transition cursor-pointer w-max">
                  Twitter
                </a>
                <a className="text-black/60 hover:text-amber-600 transition cursor-pointer w-max">
                  Discord
                </a>
                <a className="text-black/60 hover:text-amber-600 transition cursor-pointer w-max">
                  Instagram
                </a>
              </div>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center text-sm text-black/50 gap-4">
              <p>© {new Date().getFullYear()} Saku. All rights reserved.</p>
              <div className="flex gap-6">
                <a className="hover:text-amber-600 transition cursor-pointer">
                  Privacy
                </a>
                <a className="hover:text-amber-600 transition cursor-pointer">
                  Terms
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </MotionConfig>
  )
}
