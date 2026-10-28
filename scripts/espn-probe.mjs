// One-off probe: saves sample ESPN responses to samples/ so their shape can be inspected.
import { mkdir, writeFile } from "node:fs/promises";
const B = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const urls = {
  "miami-schedule": `${B}/usa.1/teams/20232/schedule`,
  "miami-fixtures": `${B}/usa.1/teams/20232/schedule?fixture=true`,
  "nassr-schedule": `${B}/ksa.1/teams/817/schedule`,
  "nassr-fixtures": `${B}/ksa.1/teams/817/schedule?fixture=true`,
  "portugal-schedule": `${B}/all/teams/482/schedule`,
  "portugal-fixtures": `${B}/all/teams/482/schedule?fixture=true`,
  "messi-athlete": `https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/45843`,
  "ronaldo-athlete": `https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/22774`,
};
await mkdir("samples", { recursive: true });
const summary = [];
for (const [name, url] of Object.entries(urls)) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    const text = await res.text();
    await writeFile(`samples/${name}.json`, text);
    summary.push(`${name}: ${res.status}, ${text.length} octets`);
    // For each schedule, also save the summary of the most recent finished match
    if (res.ok && name.endsWith("schedule")) {
      const events = JSON.parse(text).events || [];
      const done = events.filter((e) => e.competitions?.[0]?.status?.type?.completed).pop();
      if (done) {
        const league = done.league?.slug || done.competitions[0]?.league?.slug || url.split("/soccer/")[1].split("/")[0];
        const s = await fetch(`${B}/${league}/summary?event=${done.id}`, { headers: { "user-agent": "Mozilla/5.0" } });
        await writeFile(`samples/${name}-last-summary.json`, await s.text());
        summary.push(`${name}-last-summary (${league}, ${done.id}): ${s.status}`);
      }
    }
  } catch (e) { summary.push(`${name}: erreur ${e.message}`); }
}
await writeFile("samples/_resume.txt", summary.join("\n") + "\n");
console.log(summary.join("\n"));
