import { useLocalSearchParams } from "expo-router";
import PublicUpdateConfirmation from "../../../../src/screens/PublicUpdateConfirmation";

export default function UpdateConfirmation() {
  const { churchId, memberId } = useLocalSearchParams<{
    churchId: string;
    memberId: string;
  }>();
  return <PublicUpdateConfirmation churchId={churchId} memberId={memberId} />;
}