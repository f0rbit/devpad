import { startBunServer } from "./dev.js";

const database_file = process.env.DATABASE_FILE;
if (!database_file) {
	console.error("DATABASE_FILE environment variable is required");
	process.exit(1);
}

startBunServer({
	database_file,
	port: Number(process.env.PORT) || 3001,
});
