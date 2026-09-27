export const temporaryAdminSessionKey = "jchurch:temporary-admin-session:v1";
export const temporaryAdminSessionValue = "authenticated";

type TemporaryAdminCredentials = {
  username?: string;
  password?: string;
};

// Client-bundled credentials are a development-only UI gate, not authentication.
export function isValidTemporaryAdminCredentials(
  username: string,
  password: string,
  configured: TemporaryAdminCredentials = {
    username: process.env.EXPO_PUBLIC_ADMIN_USERNAME,
    password: process.env.EXPO_PUBLIC_ADMIN_PASSWORD,
  },
) {
  return (
    !!configured.username &&
    !!configured.password &&
    username === configured.username &&
    password === configured.password
  );
}