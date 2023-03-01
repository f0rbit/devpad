import pino from "pino";
import { createWriteStream } from "pino-logflare";
import { env } from "src/env/server.mjs";
import pretty from "pino-pretty";

const stream = createWriteStream({
	apiKey: env.LOGFLARE_API_KEY,
	sourceToken: env.LOGFLARE_SOURCE
});

export const logger = pino({ level: "info" }, pino.multistream([{ stream }, { stream: pretty({ colorize: true }) } ]));
