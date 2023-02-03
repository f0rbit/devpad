import "../styles/globals.css";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html className="dark">
			<head />
			<body className="bg-gray-200 text-pad-gray-900 dark:bg-pad-gray-900 dark:text-white">{children}</body>
		</html>
	);
}
