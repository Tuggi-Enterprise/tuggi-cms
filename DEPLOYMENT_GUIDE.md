# Deployment Guide: Tuggi Edge Functions

## Validated Method: `npx supabase`

We confirmed that `npx supabase` works in your environment. You do NOT need to install anything globally.

## 1. Authentication

First, check if you are logged in:
```bash
npx supabase projects list
```
If it asks to login, follow the browser flow or paste your access token.

## 2. Deployment Commands

Run these commands from the `tuggi-cms` folder:

### Deploy App Orchestrator
```bash
npx supabase functions deploy generate-contextual-narration --no-verify-jwt
```

### Deploy CMS Trigger
```bash
npx supabase functions deploy generate-description
```

### Deploy Legacy Updater
```bash
npx supabase functions deploy generate-translated-audio
```

## 3. Environment Variables (Secrets)
Ensure your production project has the keys:
```bash
npx supabase secrets set GOOGLE_GEMINI_API_KEY=...
npx supabase secrets set GOOGLE_CLOUD_API_KEY=...
```
