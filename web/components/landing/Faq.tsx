"use client";
import { useRef, useState, MutableRefObject } from "react";

interface FAQItem {
  q: string;
  a: string;
}

interface FaqsCardProps {
  faqsList: FAQItem;
  idx: number;
}

const FaqsCard = ({ faqsList, idx }: FaqsCardProps) => {
  const answerElRef = useRef<HTMLDivElement>(null) as MutableRefObject<HTMLDivElement | null>;
  const [state, setState] = useState(false);
  const [answerH, setAnswerH] = useState("0px");

  const handleOpenAnswer = () => {
    const el = answerElRef.current;
    if (!el) return;

    const answerElH = el.childNodes[0] as HTMLElement;
    setState(!state);
    setAnswerH(`${answerElH.offsetHeight + 20}px`);
  };

  return (
    <div
      className="space-y-3 mt-5 overflow-hidden border-b"
      key={idx}
      onClick={handleOpenAnswer}
    >
      <h4 className="cursor-pointer pb-5 flex items-center justify-between text-lg text-gray-700 font-medium">
        {faqsList.q}
        {state ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-gray-500 ml-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-gray-500 ml-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        )}
      </h4>

      <div
        ref={answerElRef}
        className="duration-300"
        style={state ? { height: answerH } : { height: "0px" }}
      >
        <div>
          <p className="text-gray-500 text-left">{faqsList.a}</p>
        </div>
      </div>
    </div>
  );
};

export default function FAQSection() {
    const faqsList: FAQItem[] = [
        {
        q: "What is Saku?",
        a: "Saku is a wallet application that allows you to send and receive funds using only a phone number, without the need to manage wallet addresses or complicated keys.",
        },
        {
        q: "How do transactions work on Saku?",
        a: "Users can initiate transactions by entering the recipient’s phone number. Saku securely maps phone numbers to wallets behind the scenes, making transfers fast and seamless.",
        },
        {
        q: "Do I need to remember or share wallet addresses?",
        a: "No. Saku removes the complexity of wallet addresses. All transactions are handled using phone numbers, making it easier for anyone to use.",
        },
        {
        q: "Is Saku a custodial or non-custodial wallet?",
        a: "Saku is designed to abstract technical complexity while prioritizing user security. Wallet management and transaction execution are handled securely without exposing private keys to users.",
        },
        {
        q: "Is my data and transaction information secure?",
        a: "Yes. Saku uses encryption and strict access controls to protect user data and ensure that all transactions are processed securely and privately.",
        },
    ];

  return (
    <section className="leading-relaxed max-w-screen-xl w-full mt-12 mx-auto px-4 md:px-8">
      <div className="space-y-3 text-left">
        <h1 className="text-5xl text-gray-800 font-semibold">Frequently Asked Questions</h1>
        <p className="text-gray-600 max-w-lg text-xl">
          Common questions about how Saku works and how it supports credit assessment.
        </p>
      </div>

      <div className="mt-14 max-w-screen-xl w-full">
        {faqsList.map((item, idx) => (
          <FaqsCard key={idx} idx={idx} faqsList={item} />
        ))}
      </div>
    </section>
  );
}
