import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Button, Field, Notice, Page, styles } from "../ui";
import { useAuth } from "../auth/AuthContext";
import {
  decodeGoogleIdToken,
  googleTokensFromResponse,
  isGoogleSignInAvailable,
  useGoogleAuthRequest,
} from "../auth/google-auth";
import { Text, View } from "react-native";

export default function Login() {
  const router = useRouter();
  const { login, completeGoogleSignIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleRequest, googleResponse, promptGoogle, googleNonce] = useGoogleAuthRequest();
  const googleAvailable = isGoogleSignInAvailable();

  useEffect(() => {
    if (!googleResponse) return;
    void (async () => {
      setGoogleBusy(true);
      setError("");
      try {
        if (googleResponse.type === "success") {
          const tokens = googleTokensFromResponse(googleResponse);
          const profile = decodeGoogleIdToken(tokens?.idToken);
          // Verify the nonce we sent is echoed back in the ID token.
          if (tokens && profile && profile.nonce && profile.nonce === googleNonce) {
            const accepted = await completeGoogleSignIn(profile, tokens);
            if (accepted) {
              router.replace("/");
              return;
            }
          }
          setError("Google sign-in failed. Please try again.");
        } else if (googleResponse.type === "error") {
          setError("Google sign-in failed. Please try again.");
        }
        // "cancel" / "dismiss" — user backed out; no error shown.
      } catch {
        setError("Google sign-in failed. Please try again.");
      } finally {
        setGoogleBusy(false);
      }
    })();
  }, [googleResponse]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true);
    setError("");
    const accepted = await login(username, password);
    setBusy(false);
    if (accepted) router.replace("/");
    else setError("Invalid username or password.");
  }

  async function submitGoogle() {
    setError("");
    setGoogleBusy(true);
    try {
      await promptGoogle();
    } catch {
      setGoogleBusy(false);
      setError("Google sign-in failed. Please try again.");
    }
  }

  return (
    <Page title="Sign in" eyebrow="JChurch">
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
        {googleAvailable && (
          <>
            <Text style={styles.dividerLabel}>or</Text>
            <Button
              busy={googleBusy}
              secondary
              icon="logo-google"
              disabled={!googleRequest}
              onPress={() => void submitGoogle()}
            >
              Continue with Google
            </Button>
          </>
        )}
      </View>
    </Page>
  );
}