// import pino from 'pino';
// import { createWriteStream  } from 'pino-logflare'
// import { env } from 'process';
import pino from "pino";
import { createWriteStream } from "pino-logflare";
import { env } from "src/env/server.mjs";
import fs from "fs";
import pretty from "pino-pretty";

// // create pino-logflare console stream for serverless functions and send function for browser logs
// // Browser logs are going to: https://logflare.app/sources/13989
// // Vercel log drain was setup to send logs here: https://logflare.app/sources/13830

// const { stream, send } = createWriteStream({
//     apiKey: process.env.LOGFLARE_API_KEY ?? "",
//     sourceToken: process.env.LOGFLARE_SOURCE ?? ""
// });

// // create pino logger
// const logger = pino({
//     browser: {
//         transmit: {
//             level: "info",
//             send: send,
//         }
//     },
//     level: "debug",
//     base: {
//         env: process.env.NODE_ENV,
//         revision: process.env.VERCEL_GITHUB_COMMIT_SHA,
//     },
// }, stream);

// export default logger

// import pretty from "pino-pretty"

// const stream = pretty({
//     colorize: true,
//     ignore: "pid,hostname",
//     translateTime: true
// })

const stream = createWriteStream({
	apiKey: env.LOGFLARE_API_KEY,
	sourceToken: env.LOGFLARE_SOURCE
});

const filestream = fs.createWriteStream("logs/output.log", { flags: "a" });
// override the .write function to point to the pretty.write function
filestream.write = pretty().write;

export const logger = pino({ level: "info" }, pino.multistream([{ stream }, { stream: pretty({ colorize: true }) } ]));
