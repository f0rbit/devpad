/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        "sans": ["Inter", "sans-serif"]
      },
      colors: {
        "pad-purple": {
          "50": "#d491ff",
          "100": "#ca87ff",
          "200": "#c07dff",
          "300": "#b673ff",
          "400": "#ac69f7",
          "500": "#a25fed",
          "shadow": "#a25fed66",
          "600": "#9855e3",
          "700": "#8e4bd9",
          "800": "#8441cf",
          "900": "#7a37c5"
        },
        "pad-gray": {
          "50": "#787878",
          "100": "#6e6e6e",
          "200": "#646464",
          "300": "#5a5a5a",
          "400": "#505050",
          "500": "#464646",
          "600": "#3c3c3c",
          "700": "#323232",
          "800": "#252525",
          "900": "#111111"
        }
      }
    },
  },
  plugins: [],
};
