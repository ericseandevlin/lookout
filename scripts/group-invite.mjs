// Group invite links (#601). The Admin People page does the same (#993); this stays for SSH use.
// Runs inside the app container:
//   docker compose exec app node scripts/group-invite.mjs create <code> "<label>" <max people> <days>
//   docker compose exec app node scripts/group-invite.mjs list
//   docker compose exec app node scripts/group-invite.mjs close <code>
// The link is APP_URL/join/<code>. Anyone with it can make an account until it expires, fills up or is closed.
import postgres from "postgres";

const [cmd, code, label, max, days] = process.argv.slice(2);
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const app = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const [row] = await sql`select value from app_settings where key = 'group_invites'`;
const store = row?.value ?? {};
const save = () => sql`insert into app_settings (key, value) values ('group_invites', ${sql.json(store)})
  on conflict (key) do update set value = excluded.value, updated_at = now()`;

if (cmd === "create" && /^[a-z0-9-]{4,40}$/.test(code || "") && label && Number(max) > 0 && Number(days) > 0) {
  if (store[code]) { console.error(`${code} exists. Close it or pick another code.`); process.exit(1); }
  store[code] = { label, max: Number(max), used: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + Number(days) * 864e5).toISOString() };
  await save();
  console.log(`${app}/join/${code}\n${label}: up to ${max} people, until ${store[code].expiresAt}`);
} else if (cmd === "list") {
  for (const [c, g] of Object.entries(store))
    console.log(`${c}  ${g.label}  ${g.used.length}/${g.max} used  expires ${g.expiresAt}${g.closedAt ? "  CLOSED" : ""}\n   ${g.used.join(", ")}`);
  if (!Object.keys(store).length) console.log("No group invites.");
} else if (cmd === "close" && store[code]) {
  store[code].closedAt = new Date().toISOString();
  await save();
  console.log(`Closed ${code}. People who already made accounts keep them.`);
} else {
  console.error('usage: group-invite.mjs create <code a-z0-9-> "<label>" <max> <days> | list | close <code>');
  process.exit(1);
}
await sql.end();
