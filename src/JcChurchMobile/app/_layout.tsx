import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Manrope_400Regular } from "@expo-google-fonts/manrope/400Regular";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { ActivityIndicator, View } from "react-native";
import { Providers } from "../src/providers";
import { colors } from "../src/ui";
import { useAuth } from "../src/auth/AuthContext";

function AppNavigator() {
  const { ready, authenticated } = useAuth();
  if (!ready)
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: "Manrope_700Bold" },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Protected guard={authenticated}>
          <Stack.Screen name="index" options={{ title: "JChurch" }} />
          <Stack.Screen name="settings" options={{ title: "Settings" }} />
          <Stack.Screen name="church/[churchId]" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!authenticated}>
          <Stack.Screen name="login" options={{ title: "Admin login" }} />
        </Stack.Protected>
        <Stack.Screen name="register/[churchId]/index" options={{ title: "Registration" }} />
        <Stack.Screen
          name="register/[churchId]/[eventId]/[occurrenceId]"
          options={{ title: "Registration" }}
        />
        <Stack.Screen
          name="update/[churchId]/[memberId]/index"
          options={{ title: "Update information" }}
        />
        <Stack.Screen
          name="update/[churchId]/[memberId]/confirmation"
          options={{ title: "Update complete" }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  if (!loaded && !error)
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  return (
    <Providers>
      <AppNavigator />
    </Providers>
  );
}
