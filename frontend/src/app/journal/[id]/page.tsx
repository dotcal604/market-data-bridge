import { JournalDetailPageClient } from "./page-client";

interface JournalDetailPageProps {
  params: { id: string };
}

export async function generateStaticParams(): Promise<Array<{ id: string }>> {
  return [{ id: "placeholder" }];
}

export const dynamicParams = false;

export default function JournalDetailPage({ params }: JournalDetailPageProps) {
  const { id } = params;
  return <JournalDetailPageClient id={id} />;
}
