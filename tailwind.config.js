/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./dashboard-static.html",
    "./dashboard.html",
    "./device.html",
    "./static/js/**/*.js",
  ],
  theme: {
    screens: {
      'xs': '420px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
    },
    extend: {},
  },
  plugins: [],
}
