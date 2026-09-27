import { useLocalSearchParams } from "expo-router";
import PublicUpdate from "../../../../src/screens/PublicUpdate";

export default function UpdateMember() {
  const { churchId, memberId } = useLocalSearchParams<{
    churchId: string;
    memberId: string;
  }>();
  return <PublicUpdate churchId={churchId} memberId={memberId} />;
}