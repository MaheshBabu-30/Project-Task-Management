type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  timestamp: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const serializeError = (err: unknown): LogEntry["error"] | undefined => {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (err !== undefined && err !== null) {
    return { name: "UnknownError", message: String(err) };
  }
  return undefined;
};

const write = (level: LogLevel, message: string, error?: unknown, context?: string) => {
  const entry: LogEntry = {
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
    error: serializeError(error),
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

export const logger = {
  info: (message: string, context?: string) => write("info", message, undefined, context),
  warn: (message: string, context?: string) => write("warn", message, undefined, context),
  error: (message: string, error?: unknown, context?: string) => write("error", message, error, context),
};

/** Returns a function suitable for `.catch()` with an automatic context label. */
export const catchError = (context: string) => (err: unknown) => {
  logger.error("Background task failed", err, context);
};
