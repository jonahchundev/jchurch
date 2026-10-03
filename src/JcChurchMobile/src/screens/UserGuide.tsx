import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import Markdown, { type ASTNode, type RenderRules } from "react-native-markdown-display";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Notice, Page, colors } from "../ui";
import { registrationBaseUrl } from "../api/api-url";

const defaultGuide = "README.md";
const guidePage = /^(README|\d{2}-[a-z0-9-]+)\.md$/;

function currentGuide(value?: string | string[]) {
  const page = Array.isArray(value) ? value[0] : value;
  return page && guidePage.test(page) ? page : defaultGuide;
}

function assetUrl(value: string) {
  if (/^(?:https?:|data:)/i.test(value)) return value;
  const assetPath = `/user-guide/${value.replace(/^\.?(?:\/|$)/, "")}`;
  return Platform.OS === "web"
    ? new URL(assetPath, window.location.origin).toString()
    : assetPath;
}

function withGuideAssetUrls(markdown: string) {
  return markdown.replace(
    /(!\[[^\]]*\]\()([^\s)]+)(\))/g,
    (_, prefix: string, url: string, suffix: string) => `${prefix}${assetUrl(url)}${suffix}`,
  );
}

function GuideImage({ uri, alt, width }: { uri: string; alt: string; width: number }) {
  const [aspectRatio, setAspectRatio] = useState(932 / 430);

  return (
    <Image
      source={{ uri }}
      accessibilityLabel={alt}
      resizeMode="contain"
      onLoad={({ nativeEvent }) => {
        const { width: imageWidth, height: imageHeight } = nativeEvent.source;
        if (imageWidth > 0 && imageHeight > 0) setAspectRatio(imageHeight / imageWidth);
      }}
      style={{
        width,
        height: width * aspectRatio,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    />
  );
}

export default function UserGuide() {
  const { page } = useLocalSearchParams<{ page?: string | string[] }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const file = currentGuide(page);
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");
  const imageWidth = Math.min(width - 40, 780);
  const rules: RenderRules = {
    image: (node: ASTNode) => (
      <GuideImage
        key={node.key}
        uri={node.attributes.src}
        alt={node.attributes.alt}
        width={imageWidth}
      />
    ),
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let active = true;
    setMarkdown("");
    setError("");
    fetch(`/user-guide/${file}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("The requested guide could not be loaded.");
        return response.text();
      })
      .then((source) => {
        if (active) setMarkdown(withGuideAssetUrls(source));
      })
      .catch(() => {
        if (active) setError("The guide is unavailable. Please try again later.");
      });
    return () => {
      active = false;
    };
  }, [file]);

  if (Platform.OS !== "web") {
    return (
      <Page title="User guide" eyebrow="JChurch">
        <Notice>The guide is available on the JChurch website.</Notice>
        <Button icon="open-outline" onPress={() => void Linking.openURL(`${registrationBaseUrl}/user-guide`)}>
          Open user guide
        </Button>
      </Page>
    );
  }

  return (
    <Page title="User guide" eyebrow="JChurch">
      {!markdown && !error && (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Loading user guide" />
        </View>
      )}
      {!!error && <Notice error>{error}</Notice>}
      {!!markdown && (
        <Markdown
          rules={rules}
          style={markdownStyles}
          onLinkPress={(url) => {
            if (guidePage.test(url)) {
              router.push({ pathname: "/user-guide", params: { page: url } });
              return false;
            }
            void Linking.openURL(assetUrl(url));
            return false;
          }}
        >
          {markdown}
        </Markdown>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
  },
});

const markdownStyles: StyleSheet.NamedStyles<any> = {
  body: { color: colors.ink, fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 24 },
  heading1: { color: colors.ink, fontFamily: "Manrope_700Bold", fontSize: 26, marginBottom: 12 },
  heading2: { color: colors.ink, fontFamily: "Manrope_700Bold", fontSize: 21, marginTop: 24, marginBottom: 10 },
  heading3: { color: colors.ink, fontFamily: "Manrope_700Bold", fontSize: 17, marginTop: 18, marginBottom: 8 },
  link: { color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  table: { borderColor: colors.line },
  th: { backgroundColor: colors.pale, fontFamily: "Manrope_700Bold" },
  td: { borderColor: colors.line },
};