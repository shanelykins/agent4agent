# Calendar Follow-Up MVP

Automatically generate follow-up messages for property showings using your Google Calendar.

## Setup

### 1. Get Google Calendar API credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the Google Calendar API
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Configure OAuth consent screen (set to "External" for testing)
6. Create OAuth client (Application type: Web application)
7. Add authorized redirect URI: `http://localhost:3000/oauth2callback`
8. Copy Client ID and Client Secret

### 2. Get Anthropic API key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an API key
3. Copy the key

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:
```
GOOGLE_CLIENT_ID=your_actual_client_id
GOOGLE_CLIENT_SECRET=your_actual_secret
ANTHROPIC_API_KEY=your_actual_key
```

### 4. Install and run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`

## How it works

1. Connect your Google Calendar
2. System finds events with "showing", "tour", "viewing", or "property" in title
3. Click "Generate Follow-Up" on any past showing
4. AI generates personalized message
5. Edit if needed, then send

## Next steps

- [ ] Add SMS sending (Twilio)
- [ ] Add email sending (SendGrid)
- [ ] Better event detection logic
- [ ] Store sent status in database
- [ ] Multi-user support
- [ ] Calendar overlay UI instead of list
