import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { Page, Row, styles } from "../../../src/ui";

export default function Home() {
  const { churchId } = useLocalSearchParams<{ churchId: string }>();
  const router = useRouter();
  return (
    <Page title="Your church, together." eyebrow="Home">
      <View style={styles.stack}>
        <Row
          title="Manage members"
          subtitle="Directory and member profiles"
          icon="people-outline"
          onPress={() => router.navigate(`/church/${churchId}/members`)}
        />
        <Row
          title="Search members"
          subtitle="Find someone in your church"
          icon="search-outline"
          onPress={() =>
            router.navigate({
              pathname: "/church/[churchId]/members",
              params: { churchId, search: "1" },
            })
          }
        />
        <Row
          title="Manage events"
          subtitle="Events and dated sessions"
          icon="calendar-outline"
          onPress={() => router.navigate(`/church/${churchId}/events`)}
        />
        <Row
          title="Start check-in"
          subtitle="Choose an event and session"
          icon="checkmark-circle-outline"
          onPress={() => router.navigate(`/church/${churchId}/check-in`)}
        />
      </View>
    </Page>
  );
}
