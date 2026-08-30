import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import Leaderboard from "./leaderboard";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const user = await requireChatGPTUser("/leaderboard");

  return (
    <Leaderboard
      userName={user.displayName}
      signOut={chatGPTSignOutPath("/leaderboard")}
    />
  );
}
