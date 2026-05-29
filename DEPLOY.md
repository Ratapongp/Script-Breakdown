# Deploy to Vercel

The Claude API parser runs in a Next.js API route — it needs a server. Vercel deploys this for free.

## Option A — Vercel CLI (fastest)

```sh
cd /Users/ratapong/Desktop/Screenplay/screenplay-report-generator
npx vercel
```

The CLI will:
1. Ask you to log in (browser opens — sign in with GitHub/email)
2. Ask "Set up and deploy?" → Y
3. Ask "Which scope?" → pick your personal account
4. Ask "Link to existing project?" → N
5. Ask project name → press Enter (uses default)
6. Ask root directory → press Enter
7. Ask "Override settings?" → N

It deploys a preview URL. Test it; if good, run `npx vercel --prod` for production URL.

### Set the API key on Vercel

After first deploy:

```sh
npx vercel env add ANTHROPIC_API_KEY production
# paste your key when prompted
npx vercel env add ANTHROPIC_API_KEY preview
# paste your key when prompted
npx vercel --prod   # re-deploy with the key set
```

Or via Vercel dashboard → Project → Settings → Environment Variables → add `ANTHROPIC_API_KEY` for Production + Preview.

## Option B — GitHub + Vercel web UI

If the CLI hangs on your machine:

1. Create a new GitHub repo (private is fine), then:
   ```sh
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. Go to https://vercel.com/new
3. Import the GitHub repo
4. In "Environment Variables" section, add `ANTHROPIC_API_KEY` with your key
5. Click Deploy

## What's deployed

- `/` — the upload UI
- `/api/parse` — server-side endpoint that calls Claude Opus 4.8 with the PDF and returns structured JSON

## Notes

- Vercel **Pro plan** is required if `/api/parse` runs longer than 60 seconds. Claude on a 44-page PDF typically takes 30–90s, so Hobby (free) plan may time out on long screenplays. `maxDuration: 300` (5 min) is set on the route — Pro plan honors this.
- Hobby plan: works for short screenplays (≤ ~15 pages typically finish in under 60s).
- Cost per parse: ~$0.15–$0.30 per screenplay (Claude Opus 4.8 input + output tokens).
