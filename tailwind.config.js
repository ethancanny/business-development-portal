/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Typography (Ethan, Oct 23, 2026): restored to the portal's
      // ORIGINAL font from its first build — Tailwind's default
      // system sans stack (the initial tailwind.config extended
      // nothing). Both font-sans and font-display map to it, so the
      // Cormorant/Inter redesign faces are retired everywhere,
      // including the font-display utilities, without touching any
      // component markup.
      fontFamily: {
        display: [
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
        sans: [
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
      // Design tokens (Oct 17, 2026) — mirrors of the CSS custom
      // properties in app/globals.css (the canonical list lives
      // there; the marketing site mirrors the same values in its
      // Tailwind v4 @theme). Keep the two in step.
      colors: {
        navy: {
          50: "#eef2f8",
          100: "#dbe4f0",
          600: "#1d3a66",
          700: "#16305a",
          800: "#12294d",
          900: "#0d1f3c",
          950: "#081426",
        },
        gold: {
          300: "#e6cf9e",
          400: "#d4b37a",
          500: "#b8975a",
          600: "#a07f42",
          700: "#8a6f3c",
        },
        cream: "#f7f4ec",
        caption: "var(--caption)",
      },
      borderRadius: {
        card: "18px",
        nav: "24px",
      },
      backgroundImage: {
        "gold-gradient":
          "linear-gradient(135deg, #dec084 0%, #b8975a 55%, #9c7c3f 100%)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(13, 31, 60, 0.05), 0 12px 32px -20px rgba(13, 31, 60, 0.28)",
        lift: "0 2px 4px rgba(13, 31, 60, 0.06), 0 20px 40px -20px rgba(13, 31, 60, 0.35)",
        nav: "0 10px 36px -6px rgba(13, 31, 60, 0.28), 0 2px 10px rgba(13, 31, 60, 0.14)",
        fab: "0 12px 26px -8px rgba(138, 111, 60, 0.55), 0 3px 8px rgba(13, 31, 60, 0.2)",
        pop: "0 16px 44px -12px rgba(13, 31, 60, 0.35), 0 3px 10px rgba(13, 31, 60, 0.12)",
      },
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1rem" }],
      },
      letterSpacing: {
        label: "0.14em",
      },
      transitionDuration: {
        pill: "250ms",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
