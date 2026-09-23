const webProxyPath = "/api/v1";

const defaults = {
	android: "http://10.0.2.2:7071/api/v1",
	ios: "http://127.0.0.1:7071/api/v1",
	web: "http://127.0.0.1:7071/api/v1",
};

function normalizeApiUrl(value: string, name: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${name} must be a valid HTTP(S) URL.`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error(`${name} must use http or https.`);
	if (url.search || url.hash || url.username || url.password)
		throw new Error(`${name} must not include credentials, a query, or a fragment.`);
	url.pathname = url.pathname.replace(/\/+$/, "") || "/";
	return url;
}

export function selectApiBaseUrl(
	platform: string,
	urls: { android?: string; ios?: string },
) {
	if (platform === "web") return webProxyPath;
	if (platform === "android")
		return normalizeApiUrl(
			urls.android ?? defaults.android,
			"EXPO_PUBLIC_API_URL_ANDROID",
		).toString().replace(/\/$/, "");
	return normalizeApiUrl(
		urls.ios ?? defaults.ios,
		"EXPO_PUBLIC_API_URL_IOS",
	).toString().replace(/\/$/, "");
}

export function getWebProxyTarget(value?: string) {
	return normalizeApiUrl(value ?? defaults.web, "EXPO_PUBLIC_API_URL_WEB");
}

export function proxyRequestPath(requestUrl: string, target: URL) {
	if (!requestUrl.startsWith(`${webProxyPath}/`))
		throw new Error(`Expected a request path beginning with ${webProxyPath}/.`);
	return `${target.pathname.replace(/\/$/, "")}${requestUrl.slice(webProxyPath.length)}`;
}
