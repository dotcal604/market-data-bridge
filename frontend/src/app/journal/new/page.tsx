import { JournalForm } from "@/components/journal/journal-form";

export default function NewJournalPage() {
  return (
    <div className="container mx-auto py-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">New Trade Journal Entry</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Capture your pre-trade reasoning with automatic market context
        </p>
      </div>

      <JournalForm />
    </div>
  );
}
