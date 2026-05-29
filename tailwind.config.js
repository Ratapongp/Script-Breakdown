/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', '"Sarabun"', 'system-ui', 'sans-serif'],
        report: ['"Sarabun"', '"Inter"', 'serif'],
      },
    },
  },
  plugins: [],
};
