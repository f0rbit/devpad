import "../styles/globals.css";

import { Roboto } from "@next/font/google";

const poppins = Roboto({
	weight: "400",
	subsets: ["latin"],
	variable: '--font-poppins'
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html className={"dark " + poppins.className}>
			<head />
			<body className="bg-gray-200 text-pad-gray-900 dark:bg-pad-gray-900 dark:text-white font-sans">{children}</body>
		</html>
	);
}
