// Supabase settings for "Sign in with Google / Apple / Yahoo".
// Both values are public by design (they ship to every browser); access is
// controlled by Supabase Auth and Row Level Security, not by hiding these.
// Find them in the Supabase dashboard: Project Settings → API.
// Leave them empty to run the app without the sign-in feature.
export const SUPABASE_URL = '';
export const SUPABASE_PUBLISHABLE_KEY = '';

// Supabase provider IDs. Google and Apple are built in; Yahoo is added in
// Supabase as a custom OIDC provider and must use this identifier.
export const PROVIDERS = {
  google: 'google',
  apple: 'apple',
  yahoo: 'custom:yahoo',
};
