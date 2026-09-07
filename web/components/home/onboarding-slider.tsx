"use client"

import { useState, useEffect } from "react"
import { Swiper, SwiperSlide } from "swiper/react"
import { Pagination, Autoplay, Parallax } from "swiper/modules"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"
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
  }
]

export default function OnboardingSlider() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem("saku_has_seen_onboarding")
    const isNewRegistration = localStorage.getItem("saku_just_registered")

    if (!hasSeenOnboarding && isNewRegistration) {
      setIsOpen(true)
      document.body.style.overflow = 'hidden'
    }
  }, [])

  const handleClose = () => {
    localStorage.setItem("saku_has_seen_onboarding", "true")
    localStorage.removeItem("saku_just_registered")
    document.body.style.overflow = 'unset'
    setIsOpen(false)
  }

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
                modules={[Pagination, Autoplay, Parallax]}
                parallax={true}
                onSlideChange={(swiper) => setActiveIndex(swiper.activeIndex)}
                autoplay={{ delay: 5500 }}
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
                          className="text-[10px] font-black uppercase tracking-[0.3em]"
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
              <div className="shrink-0 w-full p-6 sm:p-8 bg-white/95 backdrop-blur-md flex flex-col items-center border-t border-zinc-100 relative z-20">
                <Button 
                  onClick={handleClose}
                  style={{ backgroundColor: SAKU_ORANGE }}
                  className="w-full h-[60px] rounded-2xl text-white hover:opacity-90 transition-all group flex items-center justify-between px-8 text-lg font-bold shadow-xl shadow-[#F0A353]/25"
                >
                  <span>Explore Saku</span>
                  <motion.div
                    animate={{ x: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                  >
                    <ArrowRight className="w-6 h-6 stroke-[3px]" />
                  </motion.div>
                </Button>
              </div>
              
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    )
}