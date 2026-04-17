import type { HttpStatusCode } from "../constants/httpStatus.js";

/** Base shape for every API response. */
export interface IResp {
  success: boolean;
  statusCode: HttpStatusCode;
}

/** Successful response that carries a data payload. */
export interface IRespWithData<T> extends IResp {
  success: true;
  data: T;
}

/** Error response with a single human-readable message. */
export interface IRespWithMessage extends IResp {
  success: false;
  message: string;
}

/** Validation error response with per-field errors. */
export interface IRespWithErrors extends IResp {
  success: false;
  errors: Array<{ field: string; message: string }>;
}

export type ApiResponse<T> = IRespWithData<T> | IRespWithMessage | IRespWithErrors;
