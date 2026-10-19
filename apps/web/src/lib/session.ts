import { getAuth } from "@/lib/auth";

export async function getSessionUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) {
    return null;
  }
  return session.user;
}
