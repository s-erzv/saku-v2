"use client"

import { useEffect } from "react" // Import useEffect
import AOS from "aos" // Import AOS
import "aos/dist/aos.css" // Import CSS AOS

import { Wallet } from "lucide-react"
import Navbar from "@/components/landing/Navbar"
import StepCard from "@/components/landing/StepCard"
import FAQSection from "@/components/landing/Faq"
import Slider from "@/components/landing/Slider"

export default function Home() {
  // Inisialisasi AOS
  useEffect(() => {
    AOS.init({
      duration: 1000, // Durasi animasi (ms)
      once: true,     // Animasi hanya berjalan sekali saat scroll ke bawah
    })
  }, [])

  return (
    <div className="w-full min-h-dvh overflow-x-hidden">
      {/* NAVBAR */}
      <div className="w-full flex justify-center">
        <Navbar className="fixed" />
      </div>

      {/* Hero Section */}
      <section className="relative w-full flex flex-col gap-20 md:gap-30 py-10 justify-center bg-gradient-to-b from-primary to-background items-start text-left md:items-center md:text-center pt-48 md:pt-35 pl-6">
        <h1
          className="
            text-7xl md:text-8xl lg:text-9xl
            text-black/85 font-medium leading-none
            px-4
          "
        >
          <span className="whitespace-nowrap">
            Easy
            <video
              className="w-18 sm:w-22 md:w-28 lg:w-50 inline mx-2 align-middle"
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
        </h1>

        <a
          className="
            relative -top-10 md:-top-20
            py-4 md:py-5 px-8 md:px-12
            transition-all duration-300
            font-medium text-lg md:text-xl
            rounded-full
          "
          href="/get-started"
        >
          <Wallet className="inline mr-2 w-6 h-6 md:w-7 md:h-7 text-black" />
          Try Saku Now!
        </a>
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

        <div
          className="
            w-full
            max-w-[1400px]
            px-4 sm:px-6 md:px-10
          "
        >
          <Slider />
        </div>
      </section>

      {/* Steps Section - Added data-aos */}
            <section
              className="relative w-full flex flex-col gap-12 md:gap-20 py-10 justify-center items-start text-left md:items-center md:text-center pt-20 md:pt-30 px-6"        data-aos="fade-down"
      >
        <div className="max-w-300 flex flex-col gap-4 md:gap-6">
          <h2 className="text-3xl md:text-5xl font-semibold">
            Easy use, Get Crypto transfers done fast.
          </h2>
          <p className="text-lg md:text-2xl text-black/50">
            Easily transfer USDC without inputing the complex address
          </p>
        </div>

        <div className="w-full flex flex-col md:flex-row justify-center items-center gap-8 md:gap-10">
          <StepCard
            step={1}
            title="Top Up Once"
            description="Add crypto once and you're ready to send"
            imageSrc="/landing/steps1.png"
          />

          <StepCard
            step={2}
            title="Send by Phone Number"
            description="No wallet address, just a phone number"
            imageSrc="/landing/steps2.png"
          />

          <StepCard
            step={3}
            title="Done"
            description="Sent safely and securely without mistakes"
            imageSrc="/landing/steps3.png"
          />
        </div>
      </section>

      {/* FAQ Section - Added data-aos */}
            <section
              className="relative w-full flex flex-col gap-20 py-20 justify-center items-start text-left md:items-center md:text-center pt-20 md:pt-30 px-6"        data-aos="fade-down"
      >
        <FAQSection />
      </section>

      {/* CTA Section */}
      <section
        className="
          relative w-full md:p-10
          justify-center py-10 md:py-20
          flex flex-col md:flex-row gap-10 md:gap-40
          bg-gradient-to-b from-background to-primary
        "
      >
        <div className="flex flex-col gap-6 md:gap-10 text-left items-start md:text-left md:items-start px-6">
          <p className="text-lg md:text-2xl font-medium">
            Secure your transaction without wallet addresses. <br />
            <span className="bg-gradient-to-r from-amber-600 to-amber-800 bg-clip-text text-transparent">
              Try Saku and use your phone number instead.
            </span>
          </p>

          <a
            className="
              w-fit px-8 md:px-12 py-3 md:py-4
              bg-gradient-to-r from-amber-300 border border-black to-primary
              rounded-3xl shadow-2xl
            "
            href="/get-started"
          >
            <Wallet className="inline mr-3" />
            Try Saku Now
          </a>
        </div>

        <img
          className="hidden md:block w-[250px]"
          src="/landing/cta.gif"
          alt=""
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
  )
}