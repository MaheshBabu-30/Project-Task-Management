export const HttpStatus = {
  // 2xx
  OK:                    200,
  CREATED:               201,
  ACCEPTED:              202,
  NO_CONTENT:            204,
  // 3xx
  NOT_MODIFIED:          304,
  // 4xx
  BAD_REQUEST:           400,
  UNAUTHORIZED:          401,
  FORBIDDEN:             403,
  NOT_FOUND:             404,
  METHOD_NOT_ALLOWED:    405,
  CONFLICT:              409,
  GONE:                  410,
  UNPROCESSABLE_ENTITY:  422,
  TOO_MANY_REQUESTS:     429,
  // 5xx
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY:           502,
  SERVICE_UNAVAILABLE:   503,
} as const;

export type HttpStatusCode = typeof HttpStatus[keyof typeof HttpStatus];
