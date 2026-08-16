export type AuthContext = {
  userId: string;
  sessionId: string;
  status: 'ACTIVE';
};
export type AuthenticatedRequest = {
  headers: { cookie?: string };
  ip?: string;
  auth?: AuthContext;
};
