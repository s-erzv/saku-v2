"use client"

import React, { useEffect, useRef, useState } from "react"
// @ts-ignore
import { Splide, SplideSlide } from "@splidejs/react-splide"
import "@splidejs/react-splide/css"

export default function Slider() {
  const [active, setActive] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // 🔥 Trigger animasi pas masuk viewport
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            setActive(true)
          }, 500);
          observer.disconnect() // jalan sekali
        }
      },
      { threshold: 0.3 }
    )

    if (wrapperRef.current) observer.observe(wrapperRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <Splide
        options={{
          gap: "2rem",
          perPage: 3,
          perMove: 1,
          padding: "5rem",
          arrows: false,
          dots: false,
          pagination: false,
          breakpoints: {
            1280: {
              perPage: 2,
              padding: "3rem",
              pagination: true,
            },
            640: {
              perPage: 1,
              padding: "1.5rem",
              pagination: true,
            },
          },
        }}
        aria-label="My Favorite Images"
      >
        {/* Slide 1 */}
        <SplideSlide>
          <div
            className={`
              w-full max-w-[420px] z-5 mx-auto relative h-full max-h-[520px]
              text-left p-12 rounded-4xl bg-[#F0F8A4]
              xl:transition-all xl:duration-700 xl:ease-out
              ${active ? "xl:left-0" : "xl:left-90"}
            `}
          >
            <p className="text-4xl font-medium">
              No more long wallet addresses.
            </p>
            <img className="mx-auto w-full" src="/landing/card1.png" alt="" />
          </div>
        </SplideSlide>

        {/* Slide 2 */}
        <SplideSlide>
          <div
            className={`
              w-full max-w-[420px] z-4 mx-auto relative h-full max-h-[520px]
              text-left p-12 rounded-4xl bg-[#f7df78]
              xl:transition-all xl:duration-700 xl:ease-out
            `}
          >
            <p className="text-4xl font-medium">
              Send money with just a phone number.
            </p>
            <img className="mx-auto w-full" src="/landing/card2.png" alt="" />
          </div>
        </SplideSlide>

        {/* Slide 3 */}
        <SplideSlide>
          <div
            className={`
              w-full max-w-[420px] z-3 mx-auto relative h-full max-h-[520px]
              text-left p-12 rounded-4xl bg-[#F0F8A4]
              xl:transition-all xl:duration-700 xl:ease-out
              ${active ? "xl:right-0" : "xl:right-90"}
            `}
          >
            <p className="text-4xl font-medium">
              Transfer tokens without worry.
            </p>
            <img className="mx-auto w-full" src="/landing/card3.png" alt="" />
          </div>
        </SplideSlide>

        {/* Slide 4 */}
        <SplideSlide>
          <div
            className={`
              w-full max-w-[420px] z-2 mx-auto relative h-full max-h-[520px]
              overflow-hidden text-left p-12 rounded-4xl bg-[#f7df78]
              xl:transition-all xl:duration-700 xl:ease-out
              ${active ? "xl:right-0" : "xl:right-180"}
            `}
          >
            <p className="text-4xl font-medium">
              Secure by design.
            </p>
            <img
              className="mx-auto absolute bottom-0 left-0"
              src="/landing/card4.png"
              alt=""
            />
          </div>
        </SplideSlide>
      </Splide>
    </div>
  )
}
