import { Tabs, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, churchPath } from "../../../src/api/hooks";
import type { Church } from "../../../src/api/types";
import {
  Button,
  colors,
  Icon,
  IconButton,
  Page,
  QueryState,
} from "../../../src/ui";

export default function ChurchLayout() {
  const { churchId } = useLocalSearchParams<{ churchId: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const insets = useSafeAreaInsets();
  const query = useQuery({
    queryKey: [churchPath(churchId)],
    queryFn: ({ signal }) => api.get<Church>(churchPath(churchId), signal),
    refetchInterval: 30000,
  });
  async function changeChurch() {
    await client.cancelQueries();
    client.clear();
    router.dismissAll();
    router.replace("/");
  }
  if (query.isPending || query.error || !query.data?.active)
    return (
      <Page title="Church">
        <QueryState
          pending={query.isPending}
          error={query.error}
          empty={!query.data?.active}
          emptyText="This church is no longer active."
          onRetry={() => void query.refetch()}
        />
        <Button onPress={() => void changeChurch()}>
          Choose another church
        </Button>
      </Page>
    );
  return (
    <Tabs
      screenOptions={{
        headerTitle: query.data.name,
        headerTitleStyle: { fontFamily: "Manrope_700Bold", fontSize: 17 },
        headerStyle: { backgroundColor: colors.paper },
        headerLeft: () => (
          <IconButton
            icon="swap-horizontal-outline"
            label="Switch church"
            onPress={() => void changeChurch()}
          />
        ),
        headerRight: () => (
          <View style={{ marginRight: 8 }}>
            <IconButton
              icon="settings-outline"
              label="Settings"
              onPress={() =>
                router.push({
                  pathname: "/settings",
                  params: { selected: churchId },
                })
              }
            />
          </View>
        ),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          borderTopColor: colors.line,
          height: 64 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 6),
        },
        tabBarLabelStyle: {
          fontFamily: "Manrope_600SemiBold",
          fontSize: 12,
          lineHeight: 18,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        initialParams={{ churchId }}
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <Icon name="home-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="members"
        initialParams={{ churchId }}
        options={{
          title: "Members",
          tabBarIcon: ({ color }) => (
            <Icon name="people-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        initialParams={{ churchId }}
        options={{
          title: "Events",
          tabBarIcon: ({ color }) => (
            <Icon name="calendar-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="check-in"
        initialParams={{ churchId }}
        options={{
          title: "Check-In",
          tabBarIcon: ({ color }) => (
            <Icon name="checkmark-circle-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="groups"
        initialParams={{ churchId }}
        options={{ href: null }}
      />
    </Tabs>
  );
}
