import { requireChatGPTUser, chatGPTSignOutPath } from "./chatgpt-auth";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireChatGPTUser("/");
  return <Dashboard userName={user.displayName} userEmail={user.email} signOut={chatGPTSignOutPath("/")} />;
}
