// Fragt die Discord-Invite-API für eine Liste von Servern ab und hängt
// das Ergebnis an data/member-counts.json an. Läuft mit Node >= 18
// (nutzt das eingebaute fetch, keine externen Abhängigkeiten nötig).

import fs from 'node:fs/promises';

// Hier die zu beobachtenden Server eintragen (Invite-Code + Klartext-Label).
const SERVERS = [
  { code: 'uuBEVU9anf', label: 'PhantasiaCraft' },
  { code: 'jfHRUSYzp8', label: 'McThemeParks' }
];

const DATA_FILE = new URL('../data/member-counts.json', import.meta.url);

async function fetchInvite(code) {
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
    name: data.guild?.name ?? data.profile?.name ?? code,
    member_count: data.profile?.member_count ?? data.approximate_member_count ?? null,
    online_count: data.profile?.online_count ?? data.approximate_presence_count ?? null
  };
}

async function loadHistory() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function main() {
  const history = await loadHistory();

  const entry = {
    timestamp: new Date().toISOString(),
    servers: {}
  };

  for (const server of SERVERS) {
    try {
      const result = await fetchInvite(server.code);
      entry.servers[server.code] = { label: server.label, ...result };
      console.log(`${server.code}: ${result.member_count ?? 'unbekannt'} Mitglieder`);
    } catch (err) {
      console.error(`Fehler bei ${server.code}: ${err.message}`);
      entry.servers[server.code] = { label: server.label, error: err.message };
    }
  }

  history.push(entry);
  await fs.writeFile(DATA_FILE, JSON.stringify(history, null, 2) + '\n');
}

main();
