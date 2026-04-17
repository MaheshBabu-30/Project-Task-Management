export { BaseException } from "./BaseException.js";

import { BaseException } from "./BaseException.js";
import { HttpStatus } from "../constants/httpStatus.js";

export class BadRequestException extends BaseException {
  constructor(message: string, errData?: Record<string, unknown>) {
    super(message, HttpStatus.BAD_REQUEST, true, errData);
  }
}

export class UnauthorizedException extends BaseException {
  constructor(message: string, errData?: Record<string, unknown>) {
    super(message, HttpStatus.UNAUTHORIZED, true, errData);
  }
}

export class ForbiddenException extends BaseException {
  constructor(message: string, errData?: Record<string, unknown>) {
    super(message, HttpStatus.FORBIDDEN, true, errData);
  }
}

export class NotFoundException extends BaseException {
  constructor(message: string, errData?: Record<string, unknown>) {
    super(message, HttpStatus.NOT_FOUND, true, errData);
  }
}

export class ConflictException extends BaseException {
  constructor(message: string, errData?: Record<string, unknown>) {
    super(message, HttpStatus.CONFLICT, true, errData);
  }
}

export class UnprocessableEntityException extends BaseException {
  constructor(message: string, errData?: Record<string, unknown>) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, true, errData);
  }
}

export class TooManyRequestsException extends BaseException {
  constructor(message: string, errData?: Record<string, unknown>) {
    super(message, HttpStatus.TOO_MANY_REQUESTS, true, errData);
  }
}

export class InternalServerException extends BaseException {
  constructor(message: string, errData?: Record<string, unknown>) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR, false, errData);
  }
}
