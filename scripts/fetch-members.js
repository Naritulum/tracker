// Fragt die Discord-Invite-API für eine Liste von Servern ab und hängt
// das Ergebnis an data/member-counts.json an. Läuft mit Node >= 18
// (nutzt das eingebaute fetch, keine externen Abhängigkeiten nötig).

import fs from 'node:fs/promises';

const SERVERS = [
  { code: 'uuBEVU9anf', fallbackName: 'PhantasiaCraft' },
  { code: 'jfHRUSYzp8', fallbackName: 'McThemeParks' }
];

const DATA_FILE = new URL('../data/member-counts.json', import.meta.url);

async function fetchInvite(code, fallbackName) {
  const url = `https://discord.com/api/v9/invites/${code}`;
  const res = await fetch(url, {
    headers: {
      // Ein "normaler" User-Agent verringert das Risiko, von Cloudflare
      // als Bot geblockt zu werden.
      'User-Agent': 'Mozilla/5.0 (compatible; MemberTrackerBot/1.0)'
    }
  });

  if (!res.ok) {
    throw new Error(`Discord-API antwortete mit ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  // Discord liefert die Zahlen je nach Server-Konfiguration entweder unter
  // "profile" (neueres Server-Profil-Feature) oder als "approximate_*"
  // Feld auf oberster Ebene. Beides wird abgedeckt.
  return {
    id: data.guild?.id ?? null,
    name: data.guild?.name ?? data.profile?.name ?? fallbackName,
    member_count: data.profile?.member_count ?? data.approximate_member_count ?? null,
    online_count: data.profile?.online_count ?? data.approximate_presence_count ?? null
  };
}

async function loadData() {
  let raw;
  try {
    raw = await fs.readFile(DATA_FILE, 'utf-8');
  } catch {
    return { meta: {}, history: [] };
  }

  const parsed = JSON.parse(raw);

  // Migration vom alten Format (reines Array, id/name/label bei jedem
  // einzelnen Eintrag). Läuft automatisch beim nächsten Schreibvorgang,
  // vorhandener Verlauf bleibt erhalten.
  if (Array.isArray(parsed)) {
    const meta = {};
    const history = parsed.map(entry => {
      const servers = {};
      for (const [code, s] of Object.entries(entry.servers || {})) {
        if (s.id || s.name || s.label) {
          meta[code] = {
            id: s.id ?? meta[code]?.id ?? null,
            name: s.name ?? s.label ?? meta[code]?.name ?? null
          };
        }
        servers[code] = s.error
          ? { error: s.error }
          : { member_count: s.member_count ?? null, online_count: s.online_count ?? null };
      }
      return { timestamp: entry.timestamp, servers };
    });
    return { meta, history };
  }

  return { meta: parsed.meta || {}, history: parsed.history || [] };
}

async function main() {
  const data = await loadData();

  const entry = {
    timestamp: new Date().toISOString(),
    servers: {}
  };

  for (const server of SERVERS) {
    try {
      const result = await fetchInvite(server.code, server.fallbackName);
      data.meta[server.code] = { id: result.id, name: result.name };
      entry.servers[server.code] = {
        member_count: result.member_count,
        online_count: result.online_count
      };
      console.log(`${server.code}: ${result.member_count ?? 'unbekannt'} Mitglieder`);
    } catch (err) {
      console.error(`Fehler bei ${server.code}: ${err.message}`);
      entry.servers[server.code] = { error: err.message };
    }
  }

  data.history.push(entry);
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
}

main();
