//Gemini Code 17/07/25 17:25

const path = require('path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const fastifySession = require('@fastify/session');
const fastifyCookie = require('@fastify/cookie');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const handlebars = require('handlebars');
const fetch = require('node-fetch'); // Ensure node-fetch v2.x is used if you are using 'require'
const { createClient } = require('@supabase/supabase-js');

// Load environment variables. IMPORTANT: This must be at the very top.
require('dotenv').config();

// Validate essential environment variables immediately
if (!process.env.SUPABASE_URL) {
  console.error('FATAL ERROR: SUPABASE_URL environment variable is not set.');
  process.exit(1);
}
if (!process.env.SUPABASE_KEY) {
  console.error('FATAL ERROR: SUPABASE_KEY environment variable is not set.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('FATAL ERROR: SESSION_SECRET environment variable is not set or is too short (should be at least 32 characters).');
  process.exit(1);
}
if (!process.env.ONSHAPE_CLIENT_ID) {
    console.error('FATAL ERROR: ONSHAPE_CLIENT_ID environment variable is not set.');
    process.exit(1);
}
if (!process.env.ONSHAPE_CLIENT_SECRET) {
    console.error('FATAL ERROR: ONSHAPE_CLIENT_SECRET environment variable is not set.');
    process.exit(1);
}
if (!process.env.ONSHAPE_REDIRECT_URI) {
    console.error('FATAL ERROR: ONSHAPE_REDIRECT_URI environment variable is not set.');
    process.exit(1);
}


const fastify = Fastify({ logger: true, trustProxy: true });

// --- Supabase Client Initialization ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY // Use the service role key on the server
);

// --- Onshape API Constants ---
const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6';

// --- Handlebars Helper (for JSON formatting in templates) ---
handlebars.registerHelper('json', function (context) {
  return JSON.stringify(context, null, 2);
});

// --- Fastify Plugin Registrations ---

// 1. Cookie Plugin
fastify.register(fastifyCookie);

// 2. Session Plugin
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET, // Using the validated secret from env
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true for HTTPS only in production
    httpOnly: true, // Prevents client-side JS from accessing the session cookie
    sameSite: 'lax', // Recommended for security against CSRF
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days, adjust as needed
  },
  saveUninitialized: false, // Only create sessions for authenticated users
});

// 3. Static File Server (for assets like index.html, JS, CSS)
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/', // Serves files from /public directly under the root URL (e.g., /index.html)
});

// 4. Form Body Parser (for parsing application/x-www-form-urlencoded and JSON)
// By default, fastify-formbody parses URL-encoded, but Fastify itself handles JSON.
fastify.register(fastifyFormbody);

// 5. View Engine (Handlebars for server-side templating)
fastify.register(fastifyView, {
  engine: { handlebars },
  root: path.join(__dirname, 'src/pages'), // Assuming your .hbs template files are in 'src/pages'
  layout: false, // No default layout, specific layouts can be defined per template
});

// --- Fastify Hooks ---

// Set Security Headers for Onshape Integrated App embedding
fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('Content-Security-Policy', [
    "default-src 'self';",
    // Ensure these sources are correct for your frontend scripts (e.g., Three.js, etc.)
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;",
    "style-src 'self' 'unsafe-inline';",
    "img-src 'self' data:;",
    "connect-src 'self' https://cad.onshape.com https://api.onshape.com;", // Added api.onshape.com just in case
    "frame-ancestors 'self' https://cad.onshape.com https://*.onshape.com;", // Crucial for embedding in Onshape
  ].join(' '));
  return payload;
});

// --- Helper Functions ---

/**
 * Middleware to ensure a valid Onshape access token is available.
 * Refreshes the token if it's expired or near expiration.
 * Redirects to OAuth start if no valid token is found for Onshape-dependent routes.
 */
async function ensureValidOnshapeToken(request, reply, done) {
  const session = request.session;

  // Check if this route explicitly requires an Onshape token
  const requiresOnshapeToken = request.url.startsWith('/api/') || request.url.startsWith('/listDocuments');

  // If there's no session or no Onshape access token/expiry,
  // and the route requires an Onshape token, redirect to OAuth.
  if (!session || !session.access_token || !session.expires_at) {
    if (requiresOnshapeToken) {
      fastify.log.warn('No Onshape token found for a protected route, redirecting to /oauthStart.');
      return reply.redirect('/oauthStart');
    }
    return done(); // For routes that don't need Onshape token, proceed
  }

  const now = Date.now();
  // Refresh token if it expires within the next 60 seconds
  if (now > session.expires_at - 60000) {
    fastify.log.info('Onshape token near expiration, attempting refresh...');
    try {
      const res = await fetch(ONSHAPE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization':
            'Basic ' +
            Buffer.from(`${process.env.ONSHAPE_CLIENT_ID}:${process.env.ONSHAPE_CLIENT_SECRET}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: session.refresh_token,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        fastify.log.error(`Failed to refresh Onshape token: ${res.status} - ${errorText}`);
        if (requiresOnshapeToken) {
          // If refresh fails, force re-authorization
          return reply.redirect('/oauthStart');
        }
        return done(); // For non-Onshape routes, proceed even if refresh fails
      }

      const data = await res.json();
      session.access_token = data.access_token;
      session.refresh_token = data.refresh_token || session.refresh_token; // Refresh token might not always be returned
      session.expires_at = Date.now() + data.expires_in * 1000; // Update expiration time
      await session.save();
      fastify.log.info('Onshape token refreshed successfully.');
    } catch (err) {
      fastify.log.error('Error refreshing Onshape token:', err);
      if (requiresOnshapeToken) {
        return reply.redirect('/oauthStart');
      }
      return done(); // For non-Onshape routes
    }
  }
  done(); // Token is valid or refreshed, proceed
}

/**
 * Extracts Onshape document context parameters from query string.
 */
function extractDocumentParams(query) {
  return {
    documentId: query.d || query.documentId,
    workspaceId: query.w || query.workspaceId,
    elementId: query.e || query.elementId,
  };
}

// --- Supabase Authentication & Notes Routes ---

// POST /login - Authenticate user with Supabase (server-side call)
fastify.post('/login', async (req, reply) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return reply.code(400).send({ error: 'Email and password are required.' });
  }

  fastify.log.info(`Attempting Supabase login for: ${email}`);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    fastify.log.error('Supabase login failed:', error.message);
    return reply.code(401).send({ error: error.message, details: error.message });
  }

  // Save Supabase user session info
  req.session.user = {
    id: data.user.id,
    email: data.user.email,
    supabase_access_token: data.session.access_token, // This is the Supabase token, distinct from Onshape
  };
  fastify.log.info(`User ${data.user.email} (Supabase ID: ${data.user.id}) logged in via Supabase.`);
  return reply.send({ message: 'Login successful', userId: data.user.id });
});

// POST /signup - Register new user with Supabase (server-side call)
// Added a signup route as it's common for auth
fastify.post('/signup', async (req, reply) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return reply.code(400).send({ error: 'Email and password are required.' });
  }

  fastify.log.info(`Attempting Supabase signup for: ${email}`);
  // For signup, we also call it server-side.
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    fastify.log.error('Supabase signup failed:', error.message);
    return reply.code(400).send({ error: error.message, details: error.message });
  }

  // Handle email verification flow if enabled in Supabase
  if (data.user && !data.user.confirmed_at) {
    fastify.log.info(`Signup successful for ${email}. Email verification required.`);
    return reply.send({ message: 'Signup successful! Please check your email to verify your account.' });
  }

  // If no email verification needed (e.g., auto-confirm) or already confirmed
  req.session.user = {
    id: data.user.id,
    email: data.user.email,
    supabase_access_token: data.session.access_token,
  };
  fastify.log.info(`User ${data.user.email} (Supabase ID: ${data.user.id}) signed up and logged in via Supabase.`);
  return reply.send({ message: 'Signup successful!', userId: data.user.id });
});


// POST /logout - Log out user from Supabase session
fastify.post('/logout', async (req, reply) => {
  // Clear only the Supabase user info from session
  req.session.user = null;
  // If you want to also clear the Onshape session, add:
  // req.session.access_token = null;
  // req.session.refresh_token = null;
  // req.session.expires_at = null;

  // It's good practice to also sign out from Supabase if the token is known/used client-side
  // const { error } = await supabase.auth.signOut();
  // if (error) fastify.log.error('Supabase logout error:', error.message);

  fastify.log.info('Supabase user session cleared.');
  return reply.send({ message: 'Logged out successfully.' });
});

// GET /notes – Retrieve notes for logged-in Supabase user
fastify.get('/notes', async (req, reply) => {
  if (!req.session.user || !req.session.user.id) {
    return reply.code(401).send({ error: 'Not logged in to Supabase. Please log in to view notes.' });
  }

  const { id: user_id } = req.session.user; // Get user_id from session
  fastify.log.info(`Attempting to retrieve notes for Supabase user_id: ${user_id}`);

  // Fetch the latest note for this user
  const { data, error } = await supabase
    .from('notes')
    .select('content')
    .eq('user_id', user_id) // Filter by user_id
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    fastify.log.error('Error fetching notes from Supabase:', error.message);
    return reply.code(500).send({ error: `Failed to retrieve notes: ${error.message}` });
  }

  fastify.log.info(`Notes retrieved for Supabase user ${user_id}. Content found: ${data.length > 0}`);
  return reply.send({ content: data[0]?.content || '' }); // Send the latest note's content or empty string
});

// POST /notes – Save a note for the logged-in Supabase user
fastify.post('/notes', async (req, reply) => {
  if (!req.session.user || !req.session.user.id) {
    return reply.code(401).send({ error: 'Not logged in to Supabase. Please log in to save notes.' });
  }

  const { id: user_id } = req.session.user; // Get user_id from session
  const { content } = req.body;

  if (typeof content !== 'string') {
      return reply.code(400).send({ error: 'Note content must be a string.' });
  }

  fastify.log.info(`Attempting to save note for Supabase user_id: ${user_id}`);

  // Insert new note into the 'notes' table
  const { error } = await supabase
    .from('notes')
    .insert([{ user_id, content }]);

  if (error) {
    fastify.log.error('Error saving note to Supabase:', error.message);
    return reply.code(500).send({ error: `Failed to save note: ${error.message}` });
  }

  fastify.log.info(`Note saved successfully for Supabase user ${user_id}.`);
  return reply.send({ message: 'Note saved successfully!' });
});

// --- Onshape Integrated App Routes ---

// GET / - Root route, handles both initial app load and Onshape context
fastify.get('/', async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  let onshapeAccessToken = request.session.access_token;

  // Handle case where Onshape might pass accessToken in query params for integrated apps
  if (!onshapeAccessToken && request.query.accessToken) {
    onshapeAccessToken = request.query.accessToken;
    request.session.access_token = onshapeAccessToken;
    // For integrated apps, the OAuth flow might be simpler or managed by Onshape.
    // If no explicit `expires_in` is provided by Onshape in query, set a heuristic.
    // The `ensureValidOnshapeToken` preHandler will handle refreshing.
    request.session.expires_at = Date.now() + (3600 * 1000); // Assume 1 hour validity for query-param token initially
    await request.session.save();
    fastify.log.info('Onshape access token received from query parameters and saved to session.');
  }

  // Check if an Onshape access token is available in the session
  if (!onshapeAccessToken) {
    fastify.log.info('No Onshape access token found in session or query, rendering initial page.');
    return reply.view('index.hbs', {
      title: 'Integrated Onshape & Supabase App',
      message: 'Welcome! Please authorize Onshape or login for notes.',
      oauthUrl: '/oauthStart',
      showOnshapeAuth: true, // Flag to control visibility of Onshape auth button in your template
      showSupabaseAuth: true, // Flag to control visibility of Supabase auth form
    });
  }

  fastify.log.info('Onshape access token found, rendering assembly view.');
  // If we have an Onshape token, render the assembly view
  return reply.view('assembly_view.hbs', {
    title: 'Onshape Exploded View',
    documentId,
    workspaceId,
    elementId,
    accessToken: onshapeAccessToken, // Pass to client-side for potential direct API calls or debugging
  });
});

// Onshape API Routes - Protected by ensureValidOnshapeToken
fastify.get('/api/assemblydata', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching assembly data for D:${documentId}, W:${workspaceId}, E:${elementId}`);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters (documentId, workspaceId, elementId).');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/assemblydefinition`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      fastify.log.error(`Onshape API error fetching assembly definition (${res.status}): ${errorText}`);
      return reply.status(res.status).send(`Error fetching assembly definition: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/assemblydata:', err);
    return reply.status(500).send('Internal Server Error fetching assembly data.');
  }
});

fastify.get('/api/gltf-model', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching GLTF model for D:${documentId}, W:${workspaceId}, E:${elementId}`);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters for GLTF model.');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/gltf?outputFacetSettings=true&mode=flat`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'model/gltf+json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      fastify.log.error(`GLTF fetch failed (${res.status}): ${errorText}`);
      return reply.status(res.status).send(`Error fetching GLTF: ${errorText}`);
    }

    reply.header('Content-Type', 'model/gltf+json');
    return reply.send(res.body);
  } catch (err) {
    fastify.log.error('Error in /api/gltf-model:', err);
    return reply.status(500).send('Internal Server Error fetching GLTF model.');
  }
});

fastify.get('/api/exploded-config', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching exploded config for D:${documentId}, W:${workspaceId}, E:${elementId}`);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters for exploded config.');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/explodedviews`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      fastify.log.error(`Exploded config error (${res.status}): ${errorText}`);
      return reply.status(res.status).send(`Error fetching exploded config: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/exploded-config:', err);
    return reply.status(500).send('Internal Server Error fetching exploded config.');
  }
});

fastify.get('/api/mates', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching mates for D:${documentId}, W:${workspaceId}, E:${elementId}`);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters for mates.');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/mates`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      fastify.log.error(`Mate fetch error (${res.status}): ${errorText}`);
      return reply.status(res.status).send(`Error fetching mates: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/mates:', err);
    return reply.status(500).send('Internal Server Error fetching mates.');
  }
});

// Onshape OAuth Start
fastify.get('/oauthStart', async (request, reply) => {
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const redirectUri = process.env.ONSHAPE_REDIRECT_URI;
  const scope = 'OAuth2ReadPII OAuth2Read OAuth2Write'; // Adjust scope as needed
  const state = 'state123'; // In production, generate a cryptographically secure random state and verify it

  fastify.log.info(`Initiating Onshape OAuth flow with Redirect URI: ${redirectUri}`);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state,
  });

  return reply.redirect(`${ONSHAPE_AUTH_URL}?${params.toString()}`);
});

// Onshape OAuth Redirect Callback
fastify.get('/oauthRedirect', async (request, reply) => {
  const { code, state, error, error_description } = request.query;

  if (error) {
    fastify.log.error(`Onshape OAuth error during redirect: ${error_description || error}`);
    return reply.status(400).send(`Onshape OAuth Error: ${error_description || error}`);
  }

  if (!code) {
    return reply.status(400).send('Missing authorization code from Onshape.');
  }

  // In production, verify the 'state' parameter here to prevent CSRF attacks.
  // if (state !== 'expected_state_from_session') {
  //   return reply.status(400).send('Invalid state parameter.');
  // }

  fastify.log.info('Onshape OAuth redirect received, exchanging code for token...');

  try {
    const res = await fetch(ONSHAPE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${process.env.ONSHAPE_CLIENT_ID}:${process.env.ONSHAPE_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.ONSHAPE_REDIRECT_URI,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      fastify.log.error('Onshape token exchange failed:', res.status, data);
      return reply.status(res.status).send(`Onshape token exchange failed: ${data.error_description || JSON.stringify(data)}`);
    }

    const data = await res.json();

    request.session.access_token = data.access_token;
    request.session.refresh_token = data.refresh_token;
    request.session.expires_at = Date.now() + data.expires_in * 1000; // Convert seconds to milliseconds
    await request.session.save(); // Persist session changes

    fastify.log.info('Onshape access token and refresh token saved to session.');

    // Redirect to the root of your application, which will now have the token
    return reply.redirect('/');
  } catch (err) {
    fastify.log.error('Onshape OAuth redirect server error:', err);
    return reply.status(500).send('Onshape token exchange failed due to server error.');
  }
});

// GET /listDocuments - List Onshape documents for the authenticated user
fastify.get('/listDocuments', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  fastify.log.info('Listing Onshape documents.');

  try {
    const res = await fetch(`${ONSHAPE_API_BASE_URL}/documents`, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const error = await res.json();
      fastify.log.error('Error fetching Onshape documents:', error);
      return reply.status(res.status).send(`Failed to fetch Onshape documents: ${error.message || JSON.stringify(error)}`);
    }

    const documents = await res.json();
    return reply.view('documents.hbs', { documents }); // Render documents using a Handlebars template
  } catch (err) {
    fastify.log.error('Server error while fetching Onshape documents:', err);
    return reply.status(500).send('Server error while fetching Onshape documents.');
  }
});


// GET /currentUser - Get current Supabase user from session
fastify.get('/currentUser', async (req, reply) => {
    if (req.session.user && req.session.user.id) {
        fastify.log.info(`Returning current user: ${req.session.user.email}`);
        return reply.send({ user: { id: req.session.user.id, email: req.session.user.email } });
    } else {
        fastify.log.info('No current Supabase user in session.');
        return reply.code(401).send({ user: null, message: 'No user logged in.' });
    }
});

// --- Server Start ---
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log(`Server running on port ${fastify.server.address().port}`);
    fastify.log.info('Fastify server started successfully.');
    if (process.env.NODE_ENV !== 'production') {
        fastify.log.warn('Running in development mode. Ensure NODE_ENV=production for secure cookies in production.');
    }
  } catch (err) {
    fastify.log.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
