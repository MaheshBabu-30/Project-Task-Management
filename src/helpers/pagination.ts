import type { PaginationMeta } from "../types/common.types.js";

const MAX_LIMIT = 100;

export const buildPagination = ({
  page = 1,
  limit = 10,
  totalRecords,
}: {
  page?: number;
  limit?: number;
  totalRecords: number;
}): PaginationMeta => {
  const cappedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
  const totalPages = Math.ceil(totalRecords / cappedLimit);

  return {
    currentPage: page,
    limit: cappedLimit,
    totalRecords,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};
