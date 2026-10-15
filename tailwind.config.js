/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Premium redesign (Oct 14, 2026): Cormorant Garamond for display
      // (page titles, card headings, key numbers), Inter for UI/body.
      // Loaded via next/font/google in app/layout.tsx and exposed as
      // CSS variables so the stacks survive font-display swaps.
      fontFamily: {
        display: [
          "var(--font-display)",
          "Cormorant Garamond",
          "Georgia",
          "serif",
        ],
        sans: [
          "var(--font-sans)",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
