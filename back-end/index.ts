import express from "express";
import { validate_session, verify_host } from "./src/middleware";
import type { Session, User } from "lucia";
import { auth_router } from "./src/auth/lucia";


const app = express();
const port = 8080;

// auth middlware
app.use(verify_host);
app.use(validate_session);

app.get("/", (req, res) => {
  res.json({ hello: "world", session: res.locals.session });
});

// /auth/github (login) /auth/github/callback
app.use("/auth", auth_router);

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});


declare global {
  namespace Express {
    interface Locals {
      user: User | null;
      session: Session | null;
    }
  }
}
