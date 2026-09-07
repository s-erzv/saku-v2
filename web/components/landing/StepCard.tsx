import type React from "react"

type StepCardProps = {
  step: number | string
  title: string
  description: string
  imageSrc: string
  imageAlt?: string
}

export default function StepCard({
  step,
  title,
  description,
  imageSrc,
  imageAlt = "",
}: StepCardProps) {
  return (
    <div className="flex w-[380px] max-w-[362px] h-fit flex-col gap-6 text-left">
      <img
        className="w-80 shadow-xl rounded-3xl"
        src={imageSrc}
        alt={imageAlt}
      />

      <div className="flex gap-2">
        <p className="text-3xl text-black/50">{step}</p>

        <div>
          <p className="text-3xl">{title}</p>
          <p className="text-xl text-black/50">{description}</p>
        </div>
      </div>
    </div>
  )
}
