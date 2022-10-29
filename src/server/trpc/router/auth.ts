import { router, public_procedure, protected_procedure } from "../trpc";

export const authRouter = router({
	getSession: public_procedure.query(({ ctx }) => {
		return ctx.session;
	}),
	getSecretMessage: protected_procedure.query(() => {
		return "You are logged in and can see this secret message!";
	})
});
