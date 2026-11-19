# VerifyBot

A small, self-contained Discord verification bot.

It posts a **Verify** button in a channel. Pressing it sends the member through
Discord OAuth2, then the bot swaps their **Unverified** role for **Member** and
posts a moderation card with the account details, IP geolocation, device and
any other accounts already seen on the same residential address.

This is the verification module on its own — no shop, tickets, licenses or
other systems. Copy it, change the names and messages, and run it as your own.

---

## What it does

```
#verify  →  [ Verify ]  →  /verify  →  Discord consent
                                      ↓
                             /verify/callback
                                      ↓
              capture IP + User-Agent, exchange the code
                                      ↓
              add Member, remove Unverified, save record
                                      ↓
                    post card to #verify-logs
```

- New members automatically receive **Unverified**.
- The **Verify** button is a Discord *link* button pointing at this bot's
  `/verify` endpoint. No interaction handler is needed for the button itself.
- The callback checks that the Discord account is actually in your server
  before changing any roles.
- The log card shows account name + ID, account age, client IP, city/region/
  country, ISP + ASN, browser/OS/device, a map, and linked accounts.
- VPN / proxy / datacenter addresses are flagged. They are never used to link
  accounts, because one shared exit node would make unrelated members look
  like alts.
- Set `BLOCK_VPN=true` (or use `/verify settings block-vpn:true`) to reject
  those addresses outright instead of just flagging them.

> **Important:** Discord never gives bots a member's IP. The address is
> captured when the member hits **your** OAuth2 callback. That is how every
> "verify + IP log" bot works. It is the visitor's connection address, or their
> VPN's.

---

## Requirements

- Node.js **20 or newer**
- A Discord application and bot token
- A public HTTPS URL for the callback (a VPS, a Node host, or a tunnel while
  testing)
- The **Server Members Intent** enabled for the bot

---

## Setup

### 1. Create the Discord application

1. Open <https://discord.com/developers/applications> and create an application.
2. **Bot** tab → **Reset Token** → copy the token. This is `DISCORD_TOKEN`.
3. **General Information** → copy the **Application ID**. This is `CLIENT_ID`.
4. **OAuth2** → **Client Secret** → **Reset Secret** → copy it. This is
   `CLIENT_SECRET`.
5. **Bot** → **Privileged Gateway Intents** → enable **Server Members Intent**.
6. **OAuth2** → **Redirects** → add exactly:

   ```
   https://your-domain.example/verify/callback
   ```

   It must match `PUBLIC_URL` + `/verify/callback` character for character.
   No trailing slash. `http://localhost` is allowed for local testing; a public
   HTTPS URL is required for real members.

### 2. Invite the bot

Use the OAuth2 URL generator with:

- Scopes: `bot` and `applications.commands`
- Permissions:
  - **Manage Roles**
  - **View Channels**
  - **Send Messages**
  - **Embed Links**
  - **Attach Files**
  - **Read Message History**

Or build the invite URL manually:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268553216&scope=bot%20applications.commands
```

`268553216` covers View Channels, Send Messages, Manage Roles, Embed Links,
Attach Files and Read Message History. Adjust it if you add features.

### 3. Configure the bot

```bash
cd VerifyBot
npm install
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
```

Open `.env` and fill in:

```dotenv
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-application-id
CLIENT_SECRET=your-oauth2-client-secret
GUILD_ID=your-server-id
PUBLIC_URL=https://your-domain.example
```

Generate a separate state secret (recommended):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Put the result in `STATE_SECRET`. If it is empty, the bot falls back to
`CLIENT_SECRET`, which works but mixes two purposes into one value.

### 4. Prepare the server

Create two text channels:

| Channel | Who can see it | Purpose |
| --- | --- | --- |
| `#verify` | `@everyone` or **Unverified** | The panel and the Verify button |
| `#verify-logs` | Staff only | Verification cards |

Then set the channel permissions so the gate actually works:

- Deny **View Channel** for `@everyone` on all normal channels.
- Allow **View Channel** for **Unverified** on `#verify` only.
- Allow **View Channel**, **Send Messages**, **Embed Links** and
  **Attach Files** for the bot on `#verify-logs`.
- Allow **View Channel**, **Send Messages** and **Embed Links** for the bot on
  `#verify`.

If `@everyone` can already view every channel, removing **Unverified** does not
hide anything. The role swap still works, but it is not a gate. Use channel
overwrites if you want verification to actually lock the server.

Create the roles, or let the bot create **Unverified** on the first join:

- **Member** — the role that unlocks the server. The bot grants this.
- **Unverified** — the gate role. The bot removes this.

If the bot creates **Unverified** later, give it to existing unverified members
manually once; the automatic gate only applies to future joins.

You can use role IDs instead of names:

```dotenv
MEMBER_ROLE_ID=123456789012345678
UNVERIFIED_ROLE_ID=123456789012345679
VERIFY_LOG_CHANNEL_ID=123456789012345680
```

If those are empty, the bot looks for roles named `Member` and `Unverified`,
and a channel named `verify-logs`.

**Role hierarchy:** drag the bot's own role **above** both `Member` and
`Unverified` in **Server Settings → Roles**. Discord refuses role changes for
roles at or above the bot's highest role. The bot logs a warning when it
detects this.

### 5. Start it

```bash
npm start
```

On startup the bot:

1. logs in,
2. registers `/verify` in `GUILD_ID` (instant),
3. starts the Express server on `PORT`.

You can also register commands without restarting:

```bash
npm run deploy
```

### 6. Post the panel

In `#verify`, run:

```
/verify panel
```

The panel is posted with a green **Verify** button. If OAuth is not configured
yet, the panel explains what is missing instead of showing a broken button.
Running the command again replaces the previous panel.

Useful commands:

| Command | What it does |
| --- | --- |
| `/verify panel` | Post or refresh the panel in the current channel |
| `/verify status` | Show roles, log channel, public URL and VPN policy |
| `/verify settings block-vpn:true` | Reject VPN / proxy / datacenter addresses |
| `/verify settings block-vpn:false` | Allow them, flag them, never link them |

All three are administrator-only.

---

## How the verification logic works

### The button

The panel uses a Discord **link** button:

```js
new ButtonBuilder()
  .setLabel('Verify')
  .setEmoji('✅')
  .setStyle(ButtonStyle.Link)
  .setURL(`${PUBLIC_URL}/verify`);
```

A link button opens a URL; it does not create an interaction. That is why the
bot does not need a button handler for verification.

### `/verify`

`GET /verify` creates a signed `state` value and redirects to Discord:

```
https://discord.com/oauth2/authorize
  ?client_id=...
  &redirect_uri=https://your-domain.example/verify/callback
  &response_type=code
  &scope=identify
  &state=<timestamp>.<nonce>.<hmac>
  &prompt=consent
```

The state is `HMAC-SHA256(timestamp.nonce, STATE_SECRET)`. It is not stored in
memory, so a restart between pressing Verify and approving the consent screen
does not break the flow. The callback rejects a state that is forged, tampered
with, or older than 10 minutes.

### `/verify/callback`

The callback:

1. Rejects `error` responses (the user pressed Cancel).
2. Validates the signed state and its age.
3. Captures the client IP and `User-Agent`.
4. Exchanges the authorization code for an access token using
   `CLIENT_ID` + `CLIENT_SECRET` (server-to-server; the secret never reaches
   the browser).
5. Fetches `GET /users/@me` to get the Discord account.
6. Fetches the member from your guild. If they are not in the server, the
   callback refuses with a "join first" page.
7. Geolocates the IP with `ip-api.com` and classifies it as residential,
   VPN/proxy, or hosting.
8. If `BLOCK_VPN` is on and the address is risky, saves a blocked record,
   posts the card and refuses.
9. Adds the **Member** role.
10. Removes **Unverified** if the member has it.
11. Saves the record and posts the card to `#verify-logs`.
12. Shows a success page.

Role failures are reported honestly. If the bot cannot add **Member** (usually
a role hierarchy problem), the member sees an error page instead of a false
"verified" message.

### Linked accounts

Records are stored in `data/state.json`:

```json
{
  "guilds": {
    "123456789012345678": {
      "verifications": {
        "987654321098765432": {
          "userId": "987654321098765432",
          "username": "example",
          "address": "203.0.113.42",
          "ips": ["203.0.113.42"],
          "risky": false,
          "geo": { "ok": true, "city": "London", "country": "United Kingdom" },
          "accountAge": "2 years, 3 months",
          "verifiedAt": "2026-01-01T12:00:00.000Z"
        }
      }
    }
  }
}
```

When a new verification completes, the bot compares the address against every
stored record:

- only records with `risky: false` are compared;
- the current address and up to five previous addresses per user are checked;
- matches are shown as **Linked accounts** on the card, and the success page
  tells the member how many other accounts were seen on that address.

A VPN or datacenter address is deliberately excluded. It is shared
infrastructure, not identity.

### VPN policy

The policy is resolved per guild first, then from the environment:

```js
const blockVpn = guildState.verify?.blockVpn ?? config.verify.blockVpn;
```

`/verify settings` writes the per-guild override. `BLOCK_VPN` is the default
for guilds that have never run the command.

`classify()` marks an address risky when:

- `ip-api.com` reports `proxy: true`,
- `ip-api.com` reports `hosting: true`, or
- the ISP/org/AS contains a known VPN or hosting provider name.

If the geolocation lookup fails, the address is not marked risky. The log says
`Unknown`; the member is not punished for a provider outage.

---

## Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Bot token. Required. |
| `CLIENT_ID` | — | Application ID. Required. |
| `CLIENT_SECRET` | — | OAuth2 client secret. Required. |
| `GUILD_ID` | — | The server to verify in. Required. |
| `PUBLIC_URL` | — | Public HTTPS base, e.g. `https://verify.example.com`. Required. |
| `PORT` | `3000` | Express listen port. |
| `MEMBER_ROLE_ID` | auto | Role granted on verification. Falls back to a role named `Member`. |
| `UNVERIFIED_ROLE_ID` | auto | Role removed on verification. Falls back to `Unverified`. |
| `VERIFY_LOG_CHANNEL_ID` | auto | Log channel. Falls back to a channel named `verify-logs`. |
| `BLOCK_VPN` | `false` | Reject VPN/proxy/hosting addresses instead of flagging them. |
| `TRUST_PROXY` | `true` | Read `X-Forwarded-For`. Set `false` when directly exposed. |
| `STATE_SECRET` | `CLIENT_SECRET` | HMAC key for the OAuth2 state. Use a separate random value. |
| `VERIFY_SCOPES` | `identify` | Scopes requested at consent. Add `email` if you want email in the log. |
| `DATA_DIR` | `./data` | Where `state.json` is written. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug`. |

`REGISTER_COMMANDS_ON_START=false` skips automatic command registration.

---

## Project structure

```
VerifyBot/
├── index.js                  # process entry point
├── deploy-commands.js        # optional manual slash-command registration
├── .env.example              # every setting, with placeholders
├── src/
│   ├── config.js             # env parsing + startup validation
│   ├── logger.js             # timestamped console logger
│   ├── store.js              # atomic JSON store
│   ├── roles.js              # role lookup, Unverified creation, hierarchy check
│   ├── register.js           # slash-command registration
│   ├── client.js             # discord.js client + event wiring
│   ├── commands/
│   │   └── verify.js         # /verify panel | status | settings
│   ├── events/
│   │   ├── ready.js          # login, presence, command registration, web server
│   │   ├── interactionCreate.js
│   │   └── guildMemberAdd.js # gate new joins + greeting
│   └── verify/
│       ├── server.js         # Express routes + callback logic
│       ├── oauth.js          # state signing, authorize URL, token exchange
│       ├── ip.js             # client IP, geolocation, VPN classification
│       ├── useragent.js      # browser / OS / device parsing
│       ├── map.js            # static map attachment
│       ├── records.js        # verification storage + linked accounts
│       ├── log.js            # Discord embed builder
│       └── panel.js          # Verify panel + link button
└── data/                     # created at runtime; contains IP records
```

---

## Customizing

### Messages and branding

- Panel text: `src/verify/panel.js` → `PANEL_TEXT`
- Log card fields: `src/verify/log.js` → `buildVerifyEmbed`
- Success / error pages: `src/verify/server.js` → `page()`
- Welcome message: `src/events/guildMemberAdd.js` → `greeting()`

### Role names

Change `MEMBER_NAMES` and `UNVERIFIED_NAMES` in `src/roles.js`, or set the role
IDs in `.env`. IDs always win over names.

### Email in the log

Set:

```dotenv
VERIFY_SCOPES=identify email
```

Discord will show an email permission on the consent screen. Users can decline
it; the bot records only what was actually granted. Do not request `email` if
you do not need it — fewer scopes means a less scary consent screen.

### Website handoff

This build stops at the success page. If you also have a website that needs to
sign the member in after verification, add a signed short-lived token to a
return redirect. Keep the signing secret server-side and never put the bot
token or client secret in browser code.

### Multiple servers

This build verifies one guild (`GUILD_ID`). To support several, put the guild
ID inside the signed `state` payload, resolve it in the callback, and store a
per-guild configuration. The storage layer is already keyed by guild ID.

### Map provider

`src/verify/map.js` uses the free OpenStreetMap static-map service. It is
best-effort: if the service is down, the card falls back to an OpenStreetMap
link and still posts. Replace `fetchMap()` if you have another provider.

---

## Hosting notes

- The bot needs a **public HTTPS** URL for the callback. A Node host, VPS, or
  a tunnel (Cloudflare Tunnel, ngrok, etc.) all work.
- Set `PUBLIC_URL` to the public base, not to `localhost`, unless you are
  testing locally.
- Set `TRUST_PROXY=true` when a reverse proxy or hosting platform terminates
  TLS and forwards the request. Otherwise the captured IP will be the proxy's.
- If the bot is directly exposed to the internet with no proxy, set
  `TRUST_PROXY=false` so a client cannot spoof `X-Forwarded-For`.
- Visit `/ip` from the same network path as your members to confirm the
  detected address. It only shows the caller their own IP.
- Keep `data/state.json` private. It contains IP addresses and, if you enabled
  the email scope, email addresses.
- The free `ip-api.com` endpoint allows about 45 requests per minute and is
  HTTP-only. For a large server, use a paid HTTPS geolocation provider and
  update `geolocate()` in `src/verify/ip.js`.

---

## Troubleshooting

**`redirect_uri` mismatch on the Discord consent screen**

The redirect URI in the Developer Portal must exactly equal
`PUBLIC_URL + /verify/callback`. Check for a trailing slash, `http` vs `https`,
and a different port.

**"This link expired"**

The signed state is older than 10 minutes, or `STATE_SECRET` changed while the
link was open. Press Verify again.

**The member verifies but does not get the role**

The bot's highest role must be above `Member` and `Unverified`. Drag the bot
role up in **Server Settings → Roles**. The bot logs a warning with the exact
roles it cannot manage.

**`Missing Access` or no log card**

Give the bot **View Channel**, **Send Messages**, **Embed Links** and
**Attach Files** in `#verify-logs`. If `VERIFY_LOG_CHANNEL_ID` is set, make
sure it points at a text channel in the same server.

**New members are not gated**

The bot needs the **Server Members Intent**. Also check that the **Unverified**
role exists and that `#verify` is the only channel it can view.

**The IP is a proxy / hosting address**

That is what the visitor connected from. If every member shows the same
address, `TRUST_PROXY` or the proxy chain is wrong. Open `/ip` and compare.

**Geolocation says Unknown**

`ip-api.com` may be rate-limiting or blocked by the host. The verification
still succeeds; only the location fields are missing.

**Slash commands do not appear**

Check `GUILD_ID`. Guild commands appear instantly; global commands can take up
to an hour. Run `npm run deploy` and restart Discord.

**The panel says "Not configured"**

`PUBLIC_URL`, `CLIENT_ID` or `CLIENT_SECRET` is missing. Fill them in, restart,
then run `/verify panel` again.

---

## Privacy and security

This bot intentionally collects IP addresses, approximate location, device
information and account age. That is the point of a verification log, but it
also means you are processing personal data. Before you deploy it:

- Tell your members what is collected and why. Put it in your rules or a
  privacy notice.
- Check what your local law requires (for example, consent, a lawful basis,
  retention limits, or a deletion process).
- Restrict `#verify-logs` to staff.
- Protect `data/state.json` and back it up securely.
- Never commit `.env` or the `data/` directory.
- Rotate `DISCORD_TOKEN` and `CLIENT_SECRET` if either leaks.
- Use a separate random `STATE_SECRET`.

The bot never exposes another member's IP through a command. The log card is
only posted to the configured staff channel.

---

## License

MIT. Use it, modify it, ship it.
