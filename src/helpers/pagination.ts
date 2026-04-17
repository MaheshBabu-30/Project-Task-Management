export const buildPagination = ({
  page = 1,
  limit = 10,
  totalRecords,
}: {
  page?: number;
  limit?: number;
  totalRecords: number;
}) => {
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
