import { AuthForm } from "@/components/auth-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const nextPath = params.next?.startsWith("/") ? params.next : "/ai-drawing";
  return <AuthForm mode="sign-in" nextPath={nextPath} />;
}
