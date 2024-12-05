import express from "express";
import { handler as ssrHandler } from '../app/dist/server/entry.mjs';

const app = express();

console.log("process.env", process.env);
console.log("bun.env", Bun.env);

const base = '/';
app.use(base, express.static('../app/dist/client/'));
app.use(ssrHandler);

console.log("started server on port", process.env.PORT);
app.listen(process.env.PORT);