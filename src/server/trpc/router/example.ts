import { router, publicProcedure } from "../trpc";
import { z } from "zod";
import { TRACE_OUTPUT_VERSION } from "next/dist/shared/lib/constants";

export const exampleRouter = router({
  hello: publicProcedure
    .input(z.object({ text: z.string().nullish() }).nullish())
    .query(({ input }) => {
      return {
        greeting: `Hello ${input?.text ?? "world"}`,
      };
    }),
  getAll: publicProcedure.query(({ ctx }) => {
    console.log("session", ctx.session);
    return ctx.prisma.tODO_Item.findMany({
      include: {
        tags: true,
        children: true,
        parents: true,
        templates: true,
      }
    });
  }),
});
