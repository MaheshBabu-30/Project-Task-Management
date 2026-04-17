export type UserRole = "superadmin" | "admin" | "developer";
export type UserStatus = "active" | "inactive";

export interface TokenPayload {
  userId: string;
  role: UserRole;
  status: UserStatus;
  orgId?: string;
  orgName?: string;
}
