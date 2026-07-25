UPDATE "account"
SET "search_preferences" =
  '{"defaultRegistered":"all","defaultType":"all"}'::jsonb || "search_preferences";
