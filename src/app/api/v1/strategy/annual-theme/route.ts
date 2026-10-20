import { api } from "@/lib/api/handler";
import { getAnnualTheme, getThemeChanges } from "@/lib/data";

export const GET = api({}, async ({ req }) => {
  const year = Number(new URL(req.url).searchParams.get("year") ?? new Date().getFullYear());
  const theme = await getAnnualTheme(year);
  return theme ? { ...theme, changes: await getThemeChanges(theme.id) } : null;
});
