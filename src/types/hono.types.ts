import type { Context } from "hono";
import type { TokenPayload } from "./auth.types.js";

export type AppEnv = {
  Variables: {
    user: TokenPayload;
  };
};

/** Typed Context for all authenticated route handlers. */
export type AppContext = Context<AppEnv>;
