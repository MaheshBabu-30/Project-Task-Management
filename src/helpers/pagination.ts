import type { PaginationMeta } from "../types/common.types.js";

export const buildPagination = ({
  page = 1,
  limit = 10,
  totalRecords,
}: {
  page?: number;
  limit?: number;
  totalRecords: number;
}): PaginationMeta => {
  const totalPages = Math.ceil(totalRecords / limit);

  return {
    currentPage: page,
    limit,
    totalRecords,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};
