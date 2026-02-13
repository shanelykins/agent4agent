import express from 'express';
import { google } from 'googleapis';
import OpenAI from 'openai';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// Load .env file directly and parse it
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '.env');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=:#]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (key && value) {
        process.env[key] = value;
      }
    }
  });
  console.log('✓ .env loaded directly');
} catch (error) {
  console.error('Error loading .env:', error.message);
  // Fallback to dotenv
  dotenv.config({ path: envPath });
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3001;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/oauth2callback`;

// Initialize APIs - create OAuth client with env vars
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// OAuth flow
app.get('/auth', (req, res) => {
  // Read .env file directly every time
  const envFilePath = path.resolve(__dirname, '.env');
  let clientId = null;
  let clientSecret = null;

  try {
    const envFile = readFileSync(envFilePath, 'utf8');
    const lines = envFile.split('\n');
    for (const line of lines) {
      if (line.startsWith('GOOGLE_CLIENT_ID=')) {
        clientId = line.replace('GOOGLE_CLIENT_ID=', '').trim();
        console.log('Found CLIENT_ID:', clientId.substring(0, 20) + '...');
      }
      if (line.startsWith('GOOGLE_CLIENT_SECRET=')) {
        clientSecret = line.replace('GOOGLE_CLIENT_SECRET=', '').trim();
        console.log('Found CLIENT_SECRET');
      }
      if (clientId && clientSecret) break;
    }
    console.log('Final values - CLIENT_ID:', clientId ? 'SET' : 'NULL', 'CLIENT_SECRET:', clientSecret ? 'SET' : 'NULL');
  } catch (e) {
    console.error('Error reading .env file:', e.message);
    return res.status(500).send('Error: ' + e.message);
  }

  if (!clientId || !clientSecret) {
    return res.status(500).send(`Missing credentials. CLIENT_ID: ${clientId ? 'SET' : 'MISSING'}, SECRET: ${clientSecret ? 'SET' : 'MISSING'}`);
  }

  const client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI
  );

  // Get redirect URL from query parameter
  const redirectUrl = req.query.redirect || '/';
  console.log('/auth called with redirect:', redirectUrl);

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state: redirectUrl, // Pass redirect URL in state parameter
  });
  console.log('Generated auth URL with state:', redirectUrl);
  res.redirect(authUrl);
});

// Store OAuth tokens in memory (in production, use a database)
let oauthTokens = null;

app.get('/oauth2callback', async (req, res) => {
  const { code, state } = req.query;
  const redirectUrl = state || '/';

  console.log('OAuth callback - state:', state, 'redirectUrl:', redirectUrl);

  try {
    // Read .env file to get credentials
    const envFilePath = path.resolve(__dirname, '.env');
    let clientId = null;
    let clientSecret = null;

    try {
      const envFile = readFileSync(envFilePath, 'utf8');
      const lines = envFile.split('\n');
      for (const line of lines) {
        if (line.startsWith('GOOGLE_CLIENT_ID=')) {
          clientId = line.replace('GOOGLE_CLIENT_ID=', '').trim();
        }
        if (line.startsWith('GOOGLE_CLIENT_SECRET=')) {
          clientSecret = line.replace('GOOGLE_CLIENT_SECRET=', '').trim();
        }
        if (clientId && clientSecret) break;
      }
    } catch (e) {
      console.error('Error reading .env:', e);
    }

    const client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      REDIRECT_URI
    );
    const { tokens } = await client.getToken(code);

    // Store tokens globally
    oauthTokens = tokens;
    console.log('✓ OAuth tokens stored:', {
      access_token: tokens.access_token ? 'SET (' + tokens.access_token.substring(0, 20) + '...)' : 'MISSING',
      refresh_token: tokens.refresh_token ? 'SET' : 'MISSING',
      expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'N/A'
    });
    console.log('Full tokens object keys:', Object.keys(tokens));

    res.redirect(`${redirectUrl}?auth=success`);
  } catch (error) {
    console.error('Auth error:', error);
    res.redirect(`${redirectUrl}?auth=error`);
  }
});

// Helper function to get authenticated OAuth client
async function getAuthClient() {
  if (!oauthTokens) return null;

  const envFilePath = path.resolve(__dirname, '.env');
  let clientId = null;
  let clientSecret = null;

  try {
    const envFile = readFileSync(envFilePath, 'utf8');
    const lines = envFile.split('\n');
    for (const line of lines) {
      if (line.startsWith('GOOGLE_CLIENT_ID=')) {
        clientId = line.replace('GOOGLE_CLIENT_ID=', '').trim();
      }
      if (line.startsWith('GOOGLE_CLIENT_SECRET=')) {
        clientSecret = line.replace('GOOGLE_CLIENT_SECRET=', '').trim();
      }
      if (clientId && clientSecret) break;
    }
  } catch (e) {
    console.error('Error reading .env:', e);
    return null;
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  client.setCredentials(oauthTokens);

  // Check if token is expired and refresh if needed
  if (oauthTokens.expiry_date && oauthTokens.expiry_date <= Date.now()) {
    console.log('Token expired, attempting refresh...');
    try {
      const { credentials } = await client.refreshAccessToken();
      oauthTokens = credentials;
      client.setCredentials(oauthTokens);
      console.log('✓ Token refreshed');
    } catch (refreshError) {
      console.error('Token refresh failed:', refreshError.message);
      oauthTokens = null;
      return null;
    }
  }

  return client;
}

// Get list of all calendars
app.get('/api/calendars', async (req, res) => {
  console.log('=== /api/calendars called ===');
  try {
    const client = await getAuthClient();
    if (!client) {
      return res.status(401).json({ error: 'Not authenticated. Please connect your calendar first.', calendars: [] });
    }

    const calendar = google.calendar({ version: 'v3', auth: client });
    const response = await calendar.calendarList.list();

    const calendars = (response.data.items || []).map(cal => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary || false,
      backgroundColor: cal.backgroundColor
    }));

    console.log(`Found ${calendars.length} calendars`);
    res.json({ calendars });
  } catch (error) {
    console.error('Calendar list error:', error.message);
    res.status(500).json({ error: 'Failed to fetch calendars', calendars: [] });
  }
});

// Get calendar events (showings)
// Query params: calendarId (default: primary), todayOnly (default: false)
app.get('/api/events', async (req, res) => {
  console.log('=== /api/events called ===');
  const { calendarId = 'primary', todayOnly = 'true' } = req.query;

  try {
    const client = await getAuthClient();
    if (!client) {
      return res.status(401).json({ error: 'Not authenticated. Please connect your calendar first.', events: [] });
    }

    console.log('OAuth tokens found, attempting to fetch events...');

    const calendar = google.calendar({ version: 'v3', auth: client });

    // Calculate date range
    const now = new Date();
    let timeMin, timeMax;

    if (todayOnly === 'true') {
      // Today only: start of day to end of day
      timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else {
      // Past 7 days to future 7 days
      timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    console.log('Fetching events from', timeMin.toISOString(), 'to', timeMax.toISOString());
    console.log('Using calendar:', calendarId);

    const response = await calendar.events.list({
      calendarId: calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    console.log(`Found ${events.length} total events`);

    // Return all events (removed filtering for demo)
    console.log(`Returning ${events.length} events`);

    res.json({ events });
  } catch (error) {
    console.error('=== CALENDAR API ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('========================');
    
    // Provide more helpful error messages
    let errorMessage = 'Failed to fetch events';
    if (error.code === 401 || error.message.includes('Invalid Credentials') || error.message.includes('unauthorized')) {
      errorMessage = 'Authentication expired. Please reconnect your calendar.';
      oauthTokens = null; // Clear invalid tokens
    } else if (error.message) {
      errorMessage = 'Failed to fetch events: ' + error.message;
    }
    
    res.status(500).json({ error: errorMessage, events: [] });
  }
});

// Property context for demo
const DEMO_PROPERTY = {
  address: "950 Tennessee St #218, San Francisco, CA 94107",
  price: "$1,329,000",
  beds: 2,
  baths: 2,
  sqft: 1334,
  pricePerSqft: "$996/sqft",
  yearBuilt: 2020,
  type: "Condominium",
  neighborhood: "Dogpatch",
  hoa: "$910/month",
  parking: "1 car parking",
  highlights: [
    "Danish-inspired interiors with clean lines",
    "Domus & Domus cabinetry",
    "Caesarstone counters with large kitchen island",
    "Bosch and Bertazzoni appliances",
    "Wide-plank oak flooring",
    "In-unit washer and dryer",
    "Central A/C",
    "Attended lobby",
    "Rooftop lounge with panoramic city and bay views",
    "Landscaped courtyard, dog spa, and bike room"
  ],
  nearbySpots: "Wooly Pig, Ungrafted, Neighbor Bakehouse, Marcella's (all within half block)",
  nearbyAttractions: "Esprit Park, Chase Center, Pier 70",
  walkScore: 94,
  transitScore: 69,
  bikeScore: 93
};

// Generate follow-up message
app.post('/api/generate-message', async (req, res) => {
  try {
    const { eventSummary, eventDescription, clientName, propertyAddress } = req.body;

    const prompt = `You're a friendly real estate agent following up after showing a property. Generate a personalized text message.

PROPERTY SHOWN:
- Address: ${DEMO_PROPERTY.address}
- Price: ${DEMO_PROPERTY.price} (${DEMO_PROPERTY.pricePerSqft})
- Size: ${DEMO_PROPERTY.beds} bed, ${DEMO_PROPERTY.baths} bath, ${DEMO_PROPERTY.sqft} sqft
- Built: ${DEMO_PROPERTY.yearBuilt}
- Neighborhood: ${DEMO_PROPERTY.neighborhood}
- HOA: ${DEMO_PROPERTY.hoa}
- Key features: ${DEMO_PROPERTY.highlights.slice(0, 5).join(", ")}
- Nearby: ${DEMO_PROPERTY.nearbySpots}
- Walk Score: ${DEMO_PROPERTY.walkScore}/100

Event/Client info:
- Event: ${eventSummary}
- Notes: ${eventDescription || 'N/A'}

Write a warm, conversational follow-up text (2-3 sentences). Reference 1-2 specific features of the property they might have liked. Ask if they have questions or want to see it again. Keep it natural - no salesy language.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{
        role: 'user',
        content: prompt
      }],
      max_tokens: 200
    });

    const generatedText = completion.choices[0].message.content;
    
    res.json({ message: generatedText });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'Failed to generate message' });
  }
});

// Send SMS via Email-to-SMS gateway (using Gmail SMTP)
app.post('/api/send-message', async (req, res) => {
  try {
    const { eventId, message } = req.body;

    const smsGatewayEmail = process.env.SMS_GATEWAY_EMAIL;

    if (!smsGatewayEmail) {
      return res.status(400).json({ error: 'Missing SMS gateway configuration' });
    }

    console.log('Sending SMS via Gmail:', { to: smsGatewayEmail, messageLength: message.length });

    // Create Gmail transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    // Send email to SMS gateway
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: smsGatewayEmail,
      subject: '',
      text: message
    });

    console.log('✓ SMS sent via email gateway! ID:', info.messageId);

    res.json({ success: true, sent: true, messageId: info.messageId });
  } catch (error) {
    console.error('Send error:', error.message);
    res.status(500).json({ error: 'Failed to send message: ' + error.message });
  }
});

// App route - main dashboard
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Landing page: http://localhost:${PORT}`);
  console.log(`Onboarding: http://localhost:${PORT}/onboarding.html`);
  console.log(`App: http://localhost:${PORT}/app`);
});
