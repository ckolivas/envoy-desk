import { createFileRoute } from "@tanstack/react-router";
import { OperatorDesk } from "@/components/desk/operator-desk";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <OperatorDesk />;
}
