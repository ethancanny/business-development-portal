"use client";

/**
 * Branded offline screen. Served from the service-worker cache when a
 * navigation fails with no connection. Shell only — deal data,
 * valuations, and Directory notes are never cached, so nothing
 * sensitive is readable offline.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const LOGO = "https://cannycapitalpartners.com/canny-logo-white.png";

export default function OfflinePage() {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#0d1f3c]">
      <img
        src={PHOTO}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0d1f3c]/70 via-[#0d1f3c]/40 to-[#0d1f3c]/85" />
      <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-[#0d1f3c]/80 px-6 py-8 text-center shadow-2xl backdrop-blur-sm">
        <img
          src={LOGO}
          alt="Canny Capital Partners"
          className="mx-auto h-10 w-auto"
        />
        <div className="mx-auto mt-4 h-0.5 w-16 bg-[#b8975a]" />
        <h1 className="mt-5 text-xl font-bold text-white">You&rsquo;re offline</h1>
        <p className="mt-2 text-sm leading-relaxed text-[#e8dfc8]">
          The portal needs a connection to load pipeline, market, and
          Directory data — none of it is stored on this device. Check your
          connection and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 min-h-[44px] w-full rounded-lg bg-[#b8975a] px-4 py-2.5 text-sm font-semibold text-[#0d1f3c] transition hover:bg-[#d4b37a]"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
