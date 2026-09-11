"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Swiper, SwiperSlide } from "swiper/react"
import type { Swiper as SwiperClass } from "swiper"
import { Pagination, Parallax } from "swiper/modules"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { ArrowRight, ShieldCheck } from "lucide-react"

import { useAuth } from "@/hooks/useAuth"
import Image from "next/image"

import "swiper/css"
import "swiper/css/pagination"

const SAKU_ORANGE = "#F0A353"

const ONBOARDING_DATA = [
  {
    title: "Crypto Wallet,\nE-Wallet Simplicity.",
    description: "The power of blockchain meets the ease of your favorite payment app. No complex seed phrases, just your phone number.",
    image: "/landing/card1.png",
    accent: "Next-Gen Protocol"
  },
  {
    title: "Split Bills,\nZero Drama.",
    description: "Done with dinner? Settle up in seconds with friends. Clean, poetic logic for shared expenses.",
    image: "/landing/card2.png",
    accent: "Social Finance"
  },
  {
    title: "Saku Packets,\nInstant Joy.",
    description: "Send digital gift packets or pay anywhere with our seamless QRIS-ready scanner. Crypto made useful.",
    image: "/landing/card3.png",
    accent: "Daily Utility"
  },
  {
    title: "One Number,\nOne Risk.",
    description: "Your phone number is the only key to this account. If it is ever lost, blocked, or recycled by your carrier, there is no way back — unless you set up recovery first. It takes about a minute.",
    image: "/landing/card4.png",
    accent: "Before You Start"
  }
]

interface OnboardingSliderProps {
  /**
   * Show it regardless of whether this person has already been through it — for the
   * `/onboarding` route, which exists so the tour can be watched again on purpose.
   */
  force?: boolean
  /** Called after the closing animation is requested, for a caller that has to navigate away. */
  onClose?: () => void
}

/**
 * The first-run tour.
 *
 * It gates itself on two flags `get-started` writes at signup, which is why it can be mounted
 * unconditionally: on every visit that is not someone's first, it renders nothing. That was the
 * whole design, and it was never wired up — the component sat in the tree unimported while
 * `get-started` dutifully set the flags on every new account and sent them straight to Home, so
 * a brand new user landed on a full wallet with no introduction at all.
 *
 * The button advances, and only the last slide leaves. It used to call `handleClose` on every
 * slide, which meant the one button on screen — captioned "Explore Saku", on slide one — closed
 * the entire tour. Almost nobody saw slides two and three, and the tour read as a single splash
 * screen. Autoplay went with it: a carousel that advances itself under a reader who now has a
 * Next button is fighting them, and it used to move the copy mid-sentence.
 *
 * The last slide hands over to account recovery rather than dropping onto Home. It is written to
 * earn that: it names the risk, and the screen it opens is the one that removes it. Going to Home
 * first meant a full wallet appeared, then jumped to a security screen a second later, which
 * reads like a misfire instead of the next page of the same thing.
 */
export default function OnboardingSlider({ force = false, onClose }: OnboardingSliderProps = {}) {
  const router = useRouter()
  const { recovery } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [swiper, setSwiper] = useState<SwiperClass | null>(null)

  const isLastSlide = activeIndex === ONBOARDING_DATA.length - 1
  // Only worth offering when there is something to set up. Someone replaying the tour with
  // recovery already in place should be sent back to the app, not into a screen with nothing
  // left to ask them.
  const offerRecovery = !recovery.ready

  useEffect(() => {
    if (force) {
      setIsOpen(true)
      document.body.style.overflow = 'hidden'
      return
    }

    const hasSeenOnboarding = localStorage.getItem("saku_has_seen_onboarding")
    const isNewRegistration = localStorage.getItem("saku_just_registered")

    if (!hasSeenOnboarding && isNewRegistration) {
      setIsOpen(true)
      document.body.style.overflow = 'hidden'
    }
  }, [force])

  // Leaving the page mid-tour must not strand `overflow: hidden` on the body, which would leave
  // the whole app unscrollable with nothing on screen to explain why.
  useEffect(() => () => { document.body.style.overflow = 'unset' }, [])

  /** Marks the tour seen and releases the page. Everything that leaves goes through here. */
  const finish = () => {
    localStorage.setItem("saku_has_seen_onboarding", "true")
    localStorage.removeItem("saku_just_registered")
    document.body.style.overflow = 'unset'
    setIsOpen(false)
  }

  const handleClose = () => {
    finish()
    onClose?.()
  }

  /**
   * The primary button. Advances until the last slide, then leaves.
   *
   * `onClose` is what the `/onboarding` route passes to be returned somewhere specific, so it
   * wins: someone who opened the tour deliberately is not redirected into a setup flow they did
   * not ask for.
   */
  const handlePrimary = () => {
    if (!isLastSlide) {
      swiper?.slideNext()
      return
    }
    if (onClose) {
      handleClose()
      return
    }
    finish()
    if (offerRecovery) router.replace("/security/setup")
  }

  const primaryLabel = !isLastSlide
    ? "Next"
    : offerRecovery
      ? "Set up recovery"
      : "Explore Saku"

  return (
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            // DIKEMBALIKAN KE bg-white SESUAI ORIGINAL AWAL
            className="fixed inset-0 z-[100] bg-white flex justify-center font-sans"
          >
            {/* Inner Wrapper */}
            <div className="w-full max-w-lg h-[100dvh] flex flex-col relative overflow-hidden bg-[#FFFCF9] border-x border-zinc-100/50 shadow-sm">
              
              {/* Top Progress Indicators */}
              <div className="absolute top-0 left-0 right-0 z-[110] flex gap-1.5 p-6 pt-8 sm:pt-10">
                {ONBOARDING_DATA.map((_, i) => (
                  <div key={i} className="h-[4px] flex-grow bg-zinc-200/60 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: activeIndex >= i ? "100%" : "0%" }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: SAKU_ORANGE }}
                      transition={{ duration: 0.6, ease: "easeInOut" }}
                    />
                  </div>
                ))}
              </div>
              
              {/* Background Soft Glow */}
              <div 
                className="absolute top-[-10%] right-[-10%] w-[80%] aspect-square rounded-full blur-[120px] opacity-20 pointer-events-none" 
                style={{ backgroundColor: SAKU_ORANGE }}
              />
  
              {/* SWIPER AREA */}
              <Swiper
                modules={[Pagination, Parallax]}
                parallax={true}
                onSwiper={setSwiper}
                onSlideChange={(instance) => setActiveIndex(instance.activeIndex)}
                className="w-full flex-1 min-h-0"
              >
                {ONBOARDING_DATA.map((item, index) => (
                  <SwiperSlide key={index} className="flex flex-col h-full px-8 pt-24 pb-6 box-border">
                    
                    {/* Area Teks */}
                    <div className="shrink-0 space-y-5 sm:space-y-6 relative z-10">
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        key={`accent-${activeIndex}`}
                      >
                        <span 
                          className="text-[11px] font-bold"
                          style={{ color: SAKU_ORANGE }}
                        >
                          {item.accent}
                        </span>
                      </motion.div>
                      
                      <motion.h2 
                        data-swiper-parallax="-300"
                        className="text-4xl sm:text-5xl font-bold tracking-tighter text-zinc-900 leading-[1.05] py-1"
                      >
                        {item.title.split('\n').map((line, i) => (
                          <span key={i} className="block">{line}</span>
                        ))}
                      </motion.h2>
  
                      <motion.p 
                        data-swiper-parallax="-150"
                        className="text-zinc-500 text-base sm:text-lg font-light leading-relaxed max-w-[280px]"
                      >
                        {item.description}
                      </motion.p>
                    </div>
  
                    {/* AREA GAMBAR - Rata kiri & Jarak lega */}
                    <div className="flex-1 w-full min-h-[120px] relative z-10 mt-6 mb-10">
                      <motion.div 
                        data-swiper-parallax="-400"
                        animate={{ y: [0, -8, 0] }}
                        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 flex items-center justify-start" 
                      >
                        <div className="relative w-full h-full max-w-[220px] max-h-[220px] sm:max-w-[260px] sm:max-h-[260px]">
                          <Image 
                            src={item.image} 
                            alt="Onboarding Illustration" 
                            fill 
                            priority={index === 0}
                            className="object-contain object-left drop-shadow-[0_20px_40px_rgba(240,163,83,0.25)]"
                          />
                        </div>
                      </motion.div>
                    </div>
  
                  </SwiperSlide>
                ))}
              </Swiper>
  
              {/* BOTTOM INTERACTION AREA */}
              <div className="shrink-0 w-full p-6 sm:p-8 bg-white/95 backdrop-blur-md flex flex-col items-center gap-3 border-t border-zinc-100 relative z-20">
                <Button 
                  onClick={handlePrimary}
                  style={{ backgroundColor: SAKU_ORANGE }}
                  className="w-full h-[60px] rounded-2xl text-white hover:opacity-90 transition-all group flex items-center justify-between px-8 text-lg font-bold shadow-xl shadow-[#F0A353]/25"
                >
                  <span className="flex items-center gap-2">
                    {isLastSlide && offerRecovery && <ShieldCheck className="w-5 h-5 stroke-[2.5px]" />}
                    {primaryLabel}
                  </span>
                  <motion.div
                    animate={{ x: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                  >
                    <ArrowRight className="w-6 h-6 stroke-[3px]" />
                  </motion.div>
                </Button>

                {/* Skipping stays possible, and stays quiet. A tour with no way out is a tour
                    people close by killing the tab, and recovery asked for under duress is
                    recovery abandoned halfway. `recovery-gate.tsx` asks again in a week. */}
                {isLastSlide && offerRecovery && !onClose ? (
                  <button
                    type="button"
                    onClick={handleClose}
                    className="text-sm font-semibold text-zinc-400 hover:text-zinc-700 transition-colors py-1"
                  >
                    I&rsquo;ll do this later
                  </button>
                ) : !isLastSlide ? (
                  <button
                    type="button"
                    onClick={() => swiper?.slideTo(ONBOARDING_DATA.length - 1)}
                    className="text-sm font-semibold text-zinc-400 hover:text-zinc-700 transition-colors py-1"
                  >
                    Skip
                  </button>
                ) : (
                  <span className="h-[30px]" aria-hidden />
                )}
              </div>
              
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    )
}