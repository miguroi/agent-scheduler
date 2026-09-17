# WhatsApp Calendar Agent

The agent to help you turn everyday WhatsApp messages into Google Calendar events.

It can also read your schedule, move or cancel events, and answer questions about your calendar.

- `Schedule gym tomorrow at 7pm for 1 hour`
- `What do I have today?`
- `Move my meeting tomorrow to 3pm`
- `Cancel my gym session Friday`

```text
WhatsApp → OpenWA → Node.js → OpenRouter → Google Calendar
                         ↘ PostgreSQL
```

The whole bot runs as one TypeScript app. Docker Compose handles the app and database, while Caddy adds HTTPS on a VPS.

## Set it up

What do you need:

- Docker
- OpenRouter key
- Google OAuth web client
- WhatsApp bot number

Copy the environment file for your setup:

```bash
# Local
cp .env.local.example .env.local

# VPS
cp .env.example .env
```

Fill in the API keys, Google credentials, database password, encryption secret, app URL, timezone, and allowed WhatsApp IDs. Use the same PostgreSQL password in `POSTGRES_PASSWORD` and `DATABASE_URL`.

`ALLOWED_WHATSAPP_IDS` accepts comma-separated private chat IDs ending in `@lid` or `@c.us`. To see an ID already stored locally:

```bash
docker exec agent-scheduler-postgres-1 psql -U calendar -d calendar \
  -Atc "SELECT whatsapp_id FROM users;"
```

Do not change `TOKEN_ENCRYPTION_SECRET` after connecting calendars. Existing tokens would become unreadable.

## Set up Google OAuth

In Google Cloud:

1. Create an OAuth **Web application**.
2. Enable Google Calendar API.
3. Add your calendar account under **Audience → Test users**.
4. Add the redirect URI that matches `APP_URL`:

```text
http://localhost:3000/oauth/google/callback
https://YOUR_DOMAIN/oauth/google/callback
```

## Make it yours

The calendar rules stay fixed, while the name and writing style live in a private file:

```bash
cp config/personalization.example.json config/personalization.json
```

Edit the assistant name, language, tone, reply style, time format, help message, or extra style instructions. The private file is ignored by Git and mounted read-only by Docker. Restart the app after editing it.

## Run it locally

```bash
ENV_FILE=.env.local docker compose --env-file .env.local \
  -f compose.yaml -f compose.local.yaml up -d --build app postgres
```

Check it with `curl http://localhost:3000/health`. Keep your computer awake and Docker running.

Then connect everything:

1. Scan the OpenWA QR from **WhatsApp → Linked devices** on the bot phone.
2. Send `CONNECT` from an allowed WhatsApp account.
3. Open the Google link on this computer and approve access.
4. Send `What do I have today?`.

Other useful commands are `HELP` and `TIMEZONE Asia/Jakarta`.

To stop the local bot:

```bash
ENV_FILE=.env.local docker compose --env-file .env.local \
  -f compose.yaml -f compose.local.yaml stop app postgres
```

## Put it on a VPS

Point a domain to a fresh Ubuntu VPS and allow HTTPS on port 443. Then run:

```bash
sudo bash deploy/provision-ubuntu.sh
cp .env.example .env
cp config/personalization.example.json config/personalization.json
# Edit both files, then:
docker compose up -d --build
docker compose logs -f app
```

Register `https://YOUR_DOMAIN/oauth/google/callback` with Google before connecting. Caddy handles the certificate; PostgreSQL and OpenWA stay inside Docker.

## Safety

- Only allowlisted WhatsApp IDs can use the bot.
- Google tokens are encrypted in PostgreSQL.
- The model gets only six calendar tools.
- Deleting events and inviting guests requires `YES`.
- Calendar text and relevant messages go to OpenRouter for processing.
- OpenWA brings known npm advisories. Run `npm audit --omit=dev` before wider use.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm test
```
