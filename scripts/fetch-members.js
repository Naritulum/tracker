// Fragt die Discord-Invite-API für eine Liste von Servern ab und hängt eine
// neue Zeile an data/member-counts.csv an. Läuft mit Node >= 18 (nutzt das
// eingebaute fetch, keine externen Abhängigkeiten nötig).

import fs from 'node:fs/promises';

const SERVERS = [
  { code: 'uuBEVU9anf', name: 'PhantasiaCraft' },
  { code: 'jfHRUSYzp8', name: 'McThemeParks' }
];

const DATA_FILE = new URL('../data/member-counts.csv', import.meta.url);

// --- Kompaktes Zahlenformat (identisch zu index.html) ---
const B64_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function zigzagEncode(n) {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

function zigzagDecode(z) {
  return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
}

function encodeNumber(n) {
  let z = zigzagEncode(n);
  if (z === 0) return B64_DIGITS[0];
  let s = '';
  while (z > 0) {
    s = B64_DIGITS[z % 64] + s;
    z = Math.floor(z / 64);
  }
  return s;
}

function decodeNumber(str) {
  let z = 0;
  for (const ch of str) z = z * 64 + B64_DIGITS.indexOf(ch);
  return zigzagDecode(z);
}

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
    member_count: data.profile?.member_count ?? data.approximate_member_count ?? null,
    online_count: data.profile?.online_count ?? data.approximate_presence_count ?? null
  };
}

// Liest nur den zuletzt bekannten absoluten Stand jeder Spalte ein (nicht
// die komplette Historie) - das reicht, um das nächste Delta zu berechnen,
// und bleibt dadurch auch bei sehr vielen Zeilen schnell und speicherarm.
// "needsLeadingNewline" ist true, wenn die Datei nicht mit einem
// Zeilenumbruch endet (z.B. weil GitHub oder ein Editor ihn beim letzten
// Speichern entfernt hat) - dann muss vor dem Anhängen erst einer ergänzt
// werden, sonst würde die neue Zeile an die letzte bestehende ankleben.
async function readLastState() {
  const state = { t: null, servers: SERVERS.map(() => ({ m: null, o: null })) };
  let raw;
  try {
    raw = await fs.readFile(DATA_FILE, 'utf-8');
  } catch {
    return { ...state, needsLeadingNewline: false };
  }

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const fields = line.split(',');

    if (fields[0] !== '') {
      const d = decodeNumber(fields[0]);
      state.t = state.t === null ? d : state.t + d;
    }

    for (let i = 0; i < SERVERS.length; i++) {
      const mField = fields[1 + i * 2];
      const oField = fields[2 + i * 2];

      if (mField) {
        const d = decodeNumber(mField);
        state.servers[i].m = state.servers[i].m === null ? d : state.servers[i].m + d;
      }
      if (oField) {
        const d = decodeNumber(oField);
        state.servers[i].o = state.servers[i].o === null ? d : state.servers[i].o + d;
      }
    }
  }

  return { ...state, needsLeadingNewline: raw.length > 0 && !raw.endsWith('\n') };
}

// Kodiert einen neuen Wert relativ zum letzten bekannten Wert derselben
// Spalte. Gibt es noch keinen Vorwert (allererster Eintrag oder alle
// bisherigen Läufe fehlgeschlagen), wird der absolute Wert gespeichert -
// das ist mit derselben Kodierung möglich, ganz ohne Sonderfall beim Lesen.
function encodeField(newValue, lastValue) {
  if (newValue === null || newValue === undefined) return '';
  return encodeNumber(lastValue === null ? newValue : newValue - lastValue);
}

async function main() {
  const state = await readLastState();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const fields = [encodeField(nowSeconds, state.t)];

  for (let i = 0; i < SERVERS.length; i++) {
    const server = SERVERS[i];
    let memberCount = null;
    let onlineCount = null;
    try {
      const result = await fetchInvite(server.code);
      memberCount = result.member_count;
      onlineCount = result.online_count;
      console.log(`${server.code}: ${memberCount ?? 'unbekannt'} Mitglieder`);
    } catch (err) {
      console.error(`Fehler bei ${server.code}: ${err.message}`);
    }
    fields.push(encodeField(memberCount, state.servers[i].m));
    fields.push(encodeField(onlineCount, state.servers[i].o));
  }

  const newLine = fields.join(',') + '\n';
  await fs.appendFile(DATA_FILE, (state.needsLeadingNewline ? '\n' : '') + newLine);
}

main();
