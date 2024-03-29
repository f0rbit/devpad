import "../styles/globals.css";
import "react-datepicker/dist/react-datepicker.css";
import "../styles/datepicker.css";

import { Poppins } from "@next/font/google";

const poppins = Poppins({
	weight: "400",
	subsets: ["latin"],
	variable: "--font-poppins"
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html className={"dark " + poppins.className}>
			<head />
			<body className="bg-gray-200 font-sans text-pad-gray-900 dark:bg-pad-gray-900 dark:text-white">{children}</body>
		</html>
	);
}
