import { EvalDetailPageClient } from "./page-client";

interface EvalDetailPageProps {
  params: { id: string };
}

export async function generateStaticParams(): Promise<Array<{ id: string }>> {
  return [{ id: "placeholder" }];
}

export const dynamicParams = false;

export default function EvalDetailPage({ params }: EvalDetailPageProps) {
  const { id } = params;
  return <EvalDetailPageClient id={id} />;
}
