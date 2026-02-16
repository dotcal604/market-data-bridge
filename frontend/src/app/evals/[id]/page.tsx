import { EvalDetailClientPage } from "./page-client";

export const dynamicParams = false;

export async function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default async function EvalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EvalDetailClientPage id={id} />;
}
