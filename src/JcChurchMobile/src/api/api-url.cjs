const WEB_PROXY_PATH = "/api/v1";

function normalizeApiUrl(value, name) {
	let url;
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

function getWebProxyTarget(value) {
	return normalizeApiUrl(
		value ?? "http://127.0.0.1:7071/api/v1",
		"EXPO_PUBLIC_API_URL_WEB",
	);
}

function proxyRequestPath(requestUrl, target) {
	if (!requestUrl.startsWith(`${WEB_PROXY_PATH}/`))
		throw new Error(`Expected a request path beginning with ${WEB_PROXY_PATH}/.`);
	return `${target.pathname.replace(/\/$/, "")}${requestUrl.slice(WEB_PROXY_PATH.length)}`;
}

module.exports = { getWebProxyTarget, proxyRequestPath };
