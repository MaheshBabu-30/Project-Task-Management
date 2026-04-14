import { string, pipe, uuid } from "valibot";

/**
 * Common schema for validating UUIDs from URL parameters or body fields.
 * Ensures we don't pass malformed IDs to the database.
 */
export const uuidSchema = (fieldName: string = "ID") => 
  pipe(string(`${fieldName} must be a string`), uuid(`${fieldName} must be a valid UUID format`));
