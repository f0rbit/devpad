/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./src/**/*.{js,ts,jsx,tsx}",
			  "./app/**/*.{js,ts,jsx,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			fontFamily: {
				sans: ["Inter", "sans-serif"],
				poppins: ["var(--font-poppins)", "sans-serif" ]
			},
			colors: {
				"pad-purple": {
					50: "#d491ff",
					100: "#ca87ff",
					200: "#c07dff",
					300: "#b673ff",
					400: "#ac69f7",
					500: "#a25fed",
					shadow: "#a25fed66",
					600: "#9855e3",
					700: "#8e4bd9",
					800: "#8441cf",
					900: "#7a37c5"
				},
				"pad-gray": {
					50: "#787878",
					100: "#6e6e6e",
					200: "#646464",
					300: "#5a5a5a",
					400: "#505050",
					500: "#464646",
					600: "#3c3c3c",
					700: "#323232",
					800: "#252525",
					900: "#111111"
				},
				"base": {
					"bg-primary": "#181920",
					"accent-primary": "#1f212e",
					"accent-secondary":"#2a2c3b",
					"accent-tertiary": "#35374a",
					"text-subtlish": "#a5a7b8",
					"text-subtle": "#727485",
					"text-dark": "#505366",
					"text-secondary": "#cccede",
					"text-primary": "#dadde8",
				},
				"accent": {
					"btn-primary": "#9355d9",
					"btn-primary-hover": "#a264e8",
					"btn-secondary": "#755cdd",
					"btn-secondary-hover": "#8068e3",
					"btn-tertiary": "#6f69ef",
					"btn-tertiary-hover": "#7771f5" ,
					"btn-four": "#3b3170",
					"btn-four-hover": "#453982",
				},
				"borders": {
					"primary": "#2a2c3b",
					"secondary": "#35374a",
					"tertiary": "#373b57",
				}
			},
			borderWidth: {
				'0.5': '0.5px',
				'1': '1px',
				'1.5': '1.5px'
			}
		}
	},
	plugins: []
};
