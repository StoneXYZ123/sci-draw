import { BillingPanel } from "@/components/billing-panel";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const params = await searchParams;
  return <BillingPanel checkout={params.checkout} />;
}
