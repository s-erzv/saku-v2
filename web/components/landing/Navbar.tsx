"use client";
import { useState } from "react";

interface NavbarProps {
  className?: string;
}

export default function Navbar({ className = "" }: NavbarProps) {
  const [state, setState] = useState(false);

  const navigation = [
    { title: "Home", path: "/" },
    { title: "Wallet", path: "/home" },
    { title: "Transfer", path: "/transfer" },
    { title: "Pay", path: "/pay" }
  ];

  return (
    <nav
      className={`
        top-6
        bg-white/50
        backdrop-blur-md
        py-1
        w-[80%]
        shadow-2xl
        rounded-2xl
        border
        border-black
        z-50
        ${className}
      `}
    >
      <div className="items-center px-4 max-w-screen-xl mx-auto md:flex md:px-8">

        {/* Logo */}
        <div className="flex items-center justify-between py-3 md:py-5 md:block">
          <a href="/" className="text-green text-2xl font-bold">
            <img className="w-10 inline" src="/logo.png" alt="" /> Saku
          </a>

          {/* Mobile Toggle */}
          <div className="md:hidden">
            <button
              className="text-green outline-none p-2 rounded-md focus:border-green focus:border"
              onClick={() => setState(!state)}
            >
              {state ? (
                <svg xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0
                    011.414 0L10 8.586l4.293-4.293a1 1 0
                    111.414 1.414L11.414 10l4.293 4.293a1
                    1 0 01-1.414 1.414L10 11.414l-4.293
                    4.293a1 1 0 01-1.414-1.414L8.586 10
                    4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 8h16M4 16h16"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Nav Links Container with Animation */}
        <div
          className={`
            flex-1 
            md:block md:pb-0 md:mt-0
            transition-all duration-300 ease-in-out overflow-hidden
            ${
              state 
                ? "max-h-screen opacity-100 mt-8 pb-3" 
                : "max-h-0 opacity-0 md:max-h-full md:opacity-100"
            }
          `}
        >
          {/* Perubahan Layout Mobile: 
             - flex-col (mobile) -> md:flex-row (desktop)
             - items-start (mobile kiri) -> md:items-center (desktop tengah)
             - space-y-4 (jarak vertikal mobile) -> md:space-y-0 (reset desktop)
             - w-full (mobile full width)
          */}
          <ul className="flex flex-col w-full items-start w-full space-y-4 md:flex-row md:items-center md:justify-center md:space-x-6 md:space-y-0 md:w-auto">
            {navigation.map((item, idx) => (
              <li
                key={idx}
                className="text-green hover:text-green/70 w-full md:w-auto"
              >
                <a href={item.path} className="block w-full">{item.title}</a>
              </li>
            ))}
            
            {/* Mobile Only Sign In Button */}
            <li className="md:hidden w-full pt-2">
              <a
                href="/get-started"
                className="py-3 px-4 bg-custom3 border border-black text-custom1 hover:bg-custom3/80 rounded-full shadow block text-center w-fit "
              >
                Sign In
              </a>
            </li>
          </ul>
        </div>

        {/* Action Button (Desktop Only) */}
        <div className="hidden md:inline-block">
          <a
            href="/get-started"
            className="py-3 px-4 bg-custom3 border border-black text-custom1 hover:bg-custom3/80 rounded-full shadow"
          >
            Sign In
          </a>
        </div>
      </div>
    </nav>
  );
}