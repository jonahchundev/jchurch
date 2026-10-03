import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { canManageUsers } from "../../../src/auth/roles";
import { useRole } from "../../../src/auth/RoleContext";
import { Page, Row, styles } from "../../../src/ui";

export default function Home() {
  const { churchId } = useLocalSearchParams<{ churchId: string }>();
  const router = useRouter();
  const { roleReady, roleInfo } = useRole();
  return (
    <Page title="Your church, together." eyebrow="Home">
      <View style={styles.stack}>
        <Row
          title="Manage members"
          subtitle="Directory and member profiles"
          icon="people-outline"
          onPress={() => router.navigate(`/church/${churchId}/members`)}
        />
        {roleReady && canManageUsers(roleInfo) && (
          <Row
            title="Clean up duplicate members"
            subtitle="Find and merge repeated registrations"
            icon="copy-outline"
            onPress={() => router.navigate(`/church/${churchId}/duplicates`)}
          />
        )}
        <Row
          title="Manage groups"
          subtitle="Groups and subgroups"
          icon="albums-outline"
          onPress={() => router.navigate(`/church/${churchId}/groups`)}
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
