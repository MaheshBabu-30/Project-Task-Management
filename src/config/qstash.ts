import { Client, Receiver } from "@upstash/qstash";
import { env } from "./env.js";

export const qstashClient = env.QSTASH_TOKEN
  ? new Client({ token: env.QSTASH_TOKEN })
  : null;

export const qstashReceiver =
  env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY
    ? new Receiver({
        currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
      })
    : null;
