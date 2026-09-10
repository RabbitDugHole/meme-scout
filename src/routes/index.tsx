import { createFileRoute } from "@tanstack/react-router";
import { ScoutApp } from "@/components/scout/scout-app";
import { TwoFactorGate } from "@/components/scout/two-factor-gate";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <TwoFactorGate>
      <ScoutApp />
    </TwoFactorGate>
  );
}

