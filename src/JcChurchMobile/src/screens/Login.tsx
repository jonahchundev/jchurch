import { useState } from "react";
import { useRouter } from "expo-router";
import { Button, Field, Notice, Page, styles } from "../ui";
import { useAuth } from "../auth/AuthContext";
import { View } from "react-native";

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    const accepted = await login(username, password);
    setBusy(false);
    if (accepted) router.replace("/");
    else setError("Invalid username or password.");
  }

  return (
    <Page title="Admin login" eyebrow="JChurch">
      <View style={styles.stack}>
        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          required
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          required
        />
        {!!error && <Notice error>{error}</Notice>}
        <Button busy={busy} icon="log-in-outline" onPress={() => void submit()}>
          Log in
        </Button>
      </View>
    </Page>
  );
}