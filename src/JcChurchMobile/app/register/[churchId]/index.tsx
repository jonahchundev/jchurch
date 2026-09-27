import { useLocalSearchParams } from "expo-router";
import PublicRegister from "../../../src/screens/PublicRegister";

export default function RegisterIndex() {
  const { churchId } = useLocalSearchParams<{ churchId: string }>();
  return <PublicRegister churchId={churchId} />;
}
