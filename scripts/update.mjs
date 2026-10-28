// Keeps data.json up to date: career goal totals, each player's last match stats and next match.
// Data source: ESPN's public football data (no account or key needed).
// Usage: node scripts/update.mjs            -> check results and fixtures
//        node scripts/update.mjs 937 983    -> set both totals by hand (correction)
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../data.json", import.meta.url);
const API = "https://site.api.espn.com/apis/site/v2/sports/soccer";

// ESPN ids. "leagues" are the competitions each team plays in; "all" returns every competition when ESPN supports it.
// Messi retired from Argentina on 6 Oct 2026, so only his club is followed.
const PLAYERS = {
  m: { id: "45843", name: "Messi", feed: "m", teams: [
    { id: "20232", name: "Inter Miami", leagues: ["all", "usa.1", "concacaf.champions", "concacaf.leagues.cup", "usa.open"] },
  ] },
  r: { id: "22774", name: "Ronaldo", feed: "c", teams: [
    { id: "817", name: "Al-Nassr", leagues: ["all", "ksa.1", "afc.champions", "ksa.kings.cup"] },
    { id: "482", name: "Portugal", leagues: ["all"] },
  ] },
};
const FRIENDLIES = /friendly/; // league slugs of friendlies: their goals are not official
const LAST_MATCH_SEARCH = 5; // how many recent matches to open when looking for a player's last appearance

const data = JSON.parse(await readFile(FILE, "utf8"));
data.lastMatch ??= {};
data.next ??= {};
data.espnCounted ??= [];
const before = JSON.stringify(data);
const today = new Date();
const nowIso = today.toISOString();
const day = (offset) => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
const label = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

async function save() {
  if (JSON.stringify(data) === before) { console.log("Rien de nouveau."); return; }
  data.feed = data.feed.slice(0, 20);
  data.espnCounted = data.espnCounted.slice(-300);
  await writeFile(FILE, JSON.stringify(data, null, 2) + "\n");
  console.log(`data.json mis à jour : Messi ${data.goals.m}, Ronaldo ${data.goals.r}`);
}

// Manual correction
const [manualM, manualR] = process.argv.slice(2).map(Number);
if (Number.isInteger(manualM) && Number.isInteger(manualR)) {
  data.goals = { m: manualM, r: manualR };
  data.updated = day(0);
  data.feed.unshift([label(today), "n", `Compteurs corrigés : Messi ${manualM}, Ronaldo ${manualR}.`]);
  await save();
  process.exit(0);
}

// Errors are printed as GitHub annotations so they show on the run summary and in the failure email.
function fail(message) {
  console.log(`::error title=Mise à jour des buts::${message}`);
  process.exit(1);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// soft: a missing competition or a temporary error returns null instead of stopping the run
async function espn(path, soft = false) {
  await pause(800);
  let res;
  try { res = await fetch(API + path, { headers: { "user-agent": "Mozilla/5.0 (le-duel)" } }); }
  catch (e) { if (soft) return null; fail(`ESPN injoignable : ${e.message}`); }
  if (!res.ok) { if (soft) return null; fail(`ESPN répond ${res.status} sur ${path}`); }
  return res.json();
}

// All of a team's events (results or upcoming fixtures), merged across its competitions.
async function events(team, fixtures) {
  const byId = new Map();
  for (const league of team.leagues) {
    const body = await espn(`/${league}/teams/${team.id}/schedule${fixtures ? "?fixture=true" : ""}`, true);
    for (const e of body?.events || []) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const done = (e) => e.competitions?.[0]?.status?.type?.completed;
const leagueOf = (e) => e.league?.slug || "all";
function describe(e, team) {
  const c = e.competitions[0];
  const us = c.competitors.find((t) => t.team.id === team.id);
  const them = c.competitors.find((t) => t.team.id !== team.id);
  return {
    date: new Date(e.date).toISOString(),
    team: team.name,
    opponent: them?.team.displayName ?? "?",
    home: us?.homeAway === "home",
    league: e.league?.name || e.season?.displayName || "",
  };
}
const num = (stats, name) => Number(stats.find((s) => s.name === name)?.value ?? 0);

// Player line from a match summary, or null if the player was not in the squad
async function playerLine(e, player) {
  const summary = await espn(`/${leagueOf(e)}/summary?event=${e.id}`, true)
    ?? await espn(`/all/summary?event=${e.id}`, true);
  if (!summary) return undefined; // summary not available yet: try again on a later run
  for (const roster of summary.rosters || []) {
    const p = (roster.roster || []).find((x) => x.athlete?.id === player.id);
    if (p) return { p, summary };
  }
  return null;
}

function recordLastMatch(side, team, e, { p, summary }) {
  const played = p.starter || p.subbedIn || num(p.stats || [], "appearances") > 0;
  if (!played) return;
  if (data.lastMatch[side] && data.lastMatch[side].date >= new Date(e.date).toISOString()) return;
  const header = summary.header?.competitions?.[0]?.competitors || [];
  const own = Number(header.find((t) => t.team?.id === team.id)?.score ?? NaN);
  const other = Number(header.find((t) => t.team?.id !== team.id)?.score ?? NaN);
  const s = p.stats || [];
  data.lastMatch[side] = {
    ...describe(e, team),
    league: summary.header?.league?.name || describe(e, team).league,
    score: `${own}-${other}`,
    result: own > other ? "V" : own < other ? "D" : "N",
    stats: {
      starter: !!p.starter,
      subbedIn: !!p.subbedIn,
      subbedOut: !!p.subbedOut,
      goals: num(s, "totalGoals"),
      assists: num(s, "goalAssists"),
      shots: num(s, "totalShots"),
      shotsOn: num(s, "shotsOnTarget"),
      foulsSuffered: num(s, "foulsSuffered"),
      foulsCommitted: num(s, "foulsCommitted"),
      offsides: num(s, "offsides"),
      yellow: num(s, "yellowCards"),
      red: num(s, "redCards"),
    },
  };
}

const counted = new Set(data.espnCounted);
const fresh = []; // [date, feed entry], sorted newest first before saving
let read = 0;

for (const [side, player] of Object.entries(PLAYERS)) {
  // 1. Results: count goals of new official matches since the reference date, and keep the last match played.
  const recent = [];
  for (const team of player.teams) {
    const list = (await events(team, false)).filter(done);
    read += list.length;
    for (const e of list) recent.push({ e, team });
  }
  recent.sort((a, b) => b.e.date.localeCompare(a.e.date));

  for (const [i, { e, team }] of recent.entries()) {
    const isNew = !counted.has(e.id);
    const afterRef = e.date.slice(0, 10) >= data.since;
    const lookingForLast = !data.lastMatch[side] && i < LAST_MATCH_SEARCH;
    if (!isNew && !lookingForLast) continue;
    if (isNew && !afterRef && !lookingForLast) { counted.add(e.id); data.espnCounted.push(e.id); continue; }

    const line = await playerLine(e, player);
    if (line === undefined) continue;
    if (isNew) { counted.add(e.id); data.espnCounted.push(e.id); }
    if (!line) continue;
    recordLastMatch(side, team, e, line);

    const goals = num(line.p.stats || [], "totalGoals");
    if (!isNew || !afterRef || !goals || FRIENDLIES.test(leagueOf(e))) continue;
    const info = describe(e, team);
    data.goals[side] += goals;
    data.updated = day(0);
    const what = goals === 1 ? "marque" : goals === 2 ? "s'offre un doublé" : `marque ${goals} buts`;
    fresh.push([info.date, [label(new Date(e.date)), player.feed,
      `${player.name} ${what} contre ${info.opponent} (${data.lastMatch[side]?.league || info.league}). Il passe à ${data.goals[side]} buts.`]]);
    console.log(`${player.name} +${goals} contre ${info.opponent}`);
  }

  // 2. Next match: the earliest upcoming fixture across the player's teams.
  let next = null;
  for (const team of player.teams) {
    const e = (await events(team, true)).find((x) => !done(x) && x.date > nowIso);
    if (e && (!next || e.date < next.date)) next = describe(e, team);
  }
  data.next[side] = next;
}

fresh.sort((a, b) => b[0].localeCompare(a[0]));
data.feed.unshift(...fresh.map(([, entry]) => entry));
if (data.check?.date !== day(0)) data.check = { date: day(0), source: "ESPN", calendar: true };

console.log(`::notice title=Matchs vérifiés::${read} résultats lus. Dernier match Messi : ${data.lastMatch.m?.opponent ?? "aucun"}, Ronaldo : ${data.lastMatch.r?.opponent ?? "aucun"}. Prochain match Messi : ${data.next.m?.opponent ?? "aucun"}, Ronaldo : ${data.next.r?.opponent ?? "aucun"}.`);
await save();
