interface PageHeroProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}

export default function PageHero({ eyebrow, title, subtitle }: PageHeroProps) {
  return (
    <div className="relative h-36 overflow-hidden sm:h-44">
      <img
        src="https://cannycapitalpartners.com/arizona-desert-hero.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0d1f3c] via-[#0d1f3c]/55 to-[#0d1f3c]/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0d1f3c]/60 via-transparent to-transparent" />
      <div className="relative mx-auto flex h-full max-w-[1400px] flex-col justify-center px-4 sm:px-6">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#d4b37a]">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-1 text-2xl font-bold text-white sm:text-3xl">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm text-[#e8dfc8]">{subtitle}</p>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[#b8975a]" />
    </div>
  );
}
