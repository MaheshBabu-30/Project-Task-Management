export type UserSummary = {
  id: string;
  name: string | null;
  email?: string | null;
  avatarUrl: string | null;
};

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: string;
}

export type PaginationMeta = {
  currentPage: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};
