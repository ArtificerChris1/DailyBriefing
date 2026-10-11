import { BriefingGate } from "@/components/briefing-gate";

// The page ships with no briefing in it: every day is an encrypted file the
// browser fetches and decrypts after login.
export default function Home() {
  return <BriefingGate />;
}
