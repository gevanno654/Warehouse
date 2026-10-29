import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

import { AppError, internalError } from "../lib/errors.js";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Maps any thrown value to the contract's `ErrorResponse` shape.
 *
 * Only `AppError`, `ZodError`, and body-parser syntax failures produce a
 * specific code. Everything else is reported as `500 INTERNAL_ERROR` without
 * leaking the original message, stack trace, or any request content.
 */
function toErrorBody(error: unknown, isProduction: boolean): ErrorBody {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: { ...error.details } }),
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "The request payload is invalid.",
        details: {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    };
  }

  // `express.json()` raises a `SyntaxError` with a `type` property for
  // malformed JSON bodies. That is a schema failure, so it maps to 400.
  if (
    error instanceof SyntaxError &&
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: unknown }).type === "entity.parse.failed"
  ) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "The request body is not valid JSON.",
      },
    };
  }

  const internal = internalError();
  return {
    error: {
      code: internal.code,
      message: internal.message,
      // Keep a breadcrumb for local debugging without exposing internals to
      // production clients or the response payload.
      ...(isProduction ? {} : { details: { message: (error as Error)?.message } }),
    },
  };
}

export function createErrorHandler(options: { isProduction: boolean }): ErrorRequestHandler {
  return (error, request, response, _next) => {
    const body = toErrorBody(error, options.isProduction);

    const status =
      error instanceof AppError
        ? error.status
        : body.error.code === "VALIDATION_ERROR"
          ? 400
          : 500;

    if (status >= 500) {
      console.error(
        `[api] ${request.method} ${request.originalUrl} failed with ${body.error.code}`,
        error instanceof Error ? error.stack ?? error.message : error,
      );
    }

    if (response.headersSent) {
      // The response is already on the wire; nothing meaningful can be added.
      return;
    }

    response.status(status).json(body);
  };
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource does not exist.",
    },
  });
};
