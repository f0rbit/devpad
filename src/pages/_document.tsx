import Document, {
	Html,
	Head,
	Main,
	NextScript,
	DocumentContext
} from "next/document";

class MyDocument extends Document {
	static async getInitialProps(ctx: DocumentContext) {
		const initialProps = await Document.getInitialProps(ctx);

		return initialProps;
	}

	render() {
		return (
			<Html className="dark">
				<Head>
					<link
						href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap"
						rel="stylesheet"
					/>
				</Head>
				<body className="bg-gray-200 text-pad-gray-900 dark:bg-pad-gray-900 dark:text-white">
					<Main />
					<NextScript />
				</body>
			</Html>
		);
	}
}

export default MyDocument;
