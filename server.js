const path = require('path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const fastifySession = require('@fastify/session');
const fastifyCookie = require('@fastify/cookie');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const handlebars = require('handlebars');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const fastify = Fastify({ logger: true, trustProxy: true });

// --- Supabase setup ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY // use the service role key on the server
);

// --- Onshape Constants ---
const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6';

// --- Handlebars Helper ---
handlebars.registerHelper('json', function (context) {
  return JSON.stringify(context, null, 2);
});

// --- Middleware: Cookies & Session ---
fastify.register(fastifyCookie);
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET || 'a-very-secret-key-that-should-be-long-and-random',
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true for HTTPS only
    httpOnly: true,
    sameSite: 'lax',
  },
  saveUninitialized: false,
});

// --- Serve static files from /public ---
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/', // This serves files directly from /public, so index.html is at /index.html
});

// --- Form Body Parser ---
fastify.register(fastifyFormbody);

// --- View Engine Setup ---
fastify.register(fastifyView, {
  engine: { handlebars },
  root: path.join(__dirname, 'src/pages'), // Assuming your .hbs files are in src/pages
  layout: false,
});

// --- Security Headers for Onshape Integrated App ---
fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('Content-Security-Policy', [
    "default-src 'self';",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;",
    "style-src 'self' 'unsafe-inline';",
    "img-src 'self' data:;",
    "connect-src 'self' https://cad.onshape.com;",
    "frame-ancestors 'self' https://cad.onshape.com https://*.onshape.com;",
  ].join(' '));
  return payload;
});

// --- Helper Functions ---
async function ensureValidToken(request, reply, done) {
  const session = request.session;
  if (!session || !session.access_token || !session.expires_at) {
    // If no Onshape token, try to redirect for OAuth
    // This allows the Supabase login to work independently
    if (request.url.startsWith('/api/') || request.url.startsWith('/listDocuments')) {
      return reply.redirect('/oauthStart');
    }
    return done(); // Allow non-Onshape routes to proceed
  }

  const now = Date.now();
  if (now > session.expires_at - 60000) { // Refresh 1 minute before expiration
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
        fastify.log.error('Failed to refresh token', await res.text());
        // Only redirect if it's an Onshape-related route that requires a token
        if (request.url.startsWith('/api/') || request.url.startsWith('/listDocuments')) {
          return reply.redirect('/oauthStart');
        }
        return done();
      }

      const data = await res.json();
      session.access_token = data.access_token;
      session.refresh_token = data.refresh_token || session.refresh_token;
      session.expires_at = Date.now() + data.expires_in * 1000;
      await session.save();
      fastify.log.info('Onshape token refreshed successfully.');
    } catch (err) {
      fastify.log.error('Error refreshing Onshape token:', err);
      // Only redirect if it's an Onshape-related route that requires a token
      if (request.url.startsWith('/api/') || request.url.startsWith('/listDocuments')) {
        return reply.redirect('/oauthStart');
      }
      return done();
    }
  }
  done();
}

function extractDocumentParams(query) {
  return {
    documentId: query.d || query.documentId,
    workspaceId: query.w || query.workspaceId,
    elementId: query.e || query.elementId,
  };
}

// --- Auth routes (Supabase) ---
fastify.post('/login', async (req, reply) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return reply.code(401).send({ error: error.message });
  }

  // Save user session info
  req.session.user = {
    id: data.user.id,
    email: data.user.email,
    access_token: data.session.access_token, // Supabase access token
  };

  return reply.send({ message: 'Login successful' });
});

fastify.post('/logout', async (req, reply) => {
  req.session.user = null;
  // Also clear Onshape session if desired, though usually kept separate
  // req.session.access_token = null;
  // req.session.refresh_token = null;
  // req.session.expires_at = null;
  return reply.send({ message: 'Logged out' });
});

// --- Notes routes (Supabase) ---
fastify.get('/notes', async (req, reply) => {
  if (!req.session.user) {
    return reply.code(401).send({ error: 'Not logged in' });
  }

  const { id: user_id } = req.session.user;

  const { data, error } = await supabase
    .from('notes')
    .select('content')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    return reply.code(500).send({ error: error.message });
  }

  return reply.send({ content: data[0]?.content || '' });
});

fastify.post('/notes', async (req, reply) => {
  if (!req.session.user) {
    return reply.code(401).send({ error: 'Not logged in' });
  }

  const { id: user_id } = req.session.user;
  const { content } = req.body;

  const { error } = await supabase
    .from('notes')
    .insert([{ user_id, content }]);

  if (error) {
    return reply.code(500).send({ error: error.message });
  }

  return reply.send({ message: 'Note saved' });
});


// --- Onshape Routes ---

// Root route, serves the Onshape app if token is present
fastify.get('/', async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  let accessToken = request.session.access_token;

  // Handle case where Onshape passes accessToken in query params for integrated apps
  if (!accessToken && request.query.accessToken) {
    accessToken = request.query.accessToken;
    request.session.access_token = accessToken;
    // Set a dummy expires_at to force a refresh on next API call if not a full OAuth flow
    // Or ideally, the Onshape integrated app framework provides expiration or a way to get one.
    // For now, setting a long expiration or relying on ensureValidToken to refresh.
    request.session.expires_at = Date.now() + (3600 * 1000); // 1 hour for now, will be refreshed
    await request.session.save();
    fastify.log.info('Onshape access token received from query and saved to session.');
  }
 
  if (!accessToken) {
    return reply.view('index.hbs', {
      title: 'Notes (or Onshape App)', // Adjust title based on primary view
      message: 'Please authorize the Onshape app first, or log in for notes.',
      oauthUrl: '/oauthStart',
      showOnshapeAuth: true, // Flag to show Onshape auth button
    });
  }

  // If we have an Onshape token, render the assembly view
  return reply.view('assembly_view.hbs', {
    title: 'Exploded View',
    documentId,
    workspaceId,
    elementId,
    accessToken: accessToken, // Pass to client-side for potential direct API calls or debugging
  });
});

fastify.get('/api/assemblydata', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching assembly data with access token: ${request.session.access_token ? 'present' : 'missing'}`);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters.');
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
      fastify.log.error(`Onshape API error: ${res.status} ${errorText}`);
      return reply.status(res.status).send(`Error: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/assemblydata:', err);
    return reply.status(500).send('Internal Server Error.');
  }
});

fastify.get('/api/gltf-model', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching GLTF model with access token: ${request.session.access_token ? 'present' : 'missing'}`);

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
      fastify.log.error(`GLTF fetch failed: ${res.status} ${errorText}`);
      return reply.status(res.status).send(`Error fetching GLTF: ${errorText}`);
    }

    reply.header('Content-Type', 'model/gltf+json');
    return reply.send(res.body);
  } catch (err) {
    fastify.log.error('Error in /api/gltf-model:', err);
    return reply.status(500).send('Internal Server Error fetching GLTF model.');
  }
});

fastify.get('/api/exploded-config', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching exploded config with access token: ${request.session.access_token ? 'present' : 'missing'}`);

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
      fastify.log.error(`Exploded config error: ${res.status} ${errorText}`);
      return reply.status(res.status).send(`Error: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/exploded-config:', err);
    return reply.status(500).send('Internal Server Error fetching exploded config.');
  }
});

fastify.get('/api/mates', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching mates with access token: ${request.session.access_token ? 'present' : 'missing'}`);

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
      fastify.log.error(`Mate fetch error: ${res.status} ${errorText}`);
      return reply.status(res.status).send(`Error: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/mates:', err);
    return reply.status(500).send('Internal Server Error fetching mates.');
  }
});

fastify.get('/oauthStart', async (request, reply) => {
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const redirectUri = process.env.ONSHAPE_REDIRECT_URI;
  const scope = 'OAuth2ReadPII OAuth2Read OAuth2Write';
  const state = 'state123'; // In a real app, generate a unique state and verify it on redirect

  if (!clientId || !redirectUri) {
    return reply.status(500).send('Missing ONSHAPE_CLIENT_ID or ONSHAPE_REDIRECT_URI in environment variables.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state,
  });

  return reply.redirect(`${ONSHAPE_AUTH_URL}?${params.toString()}`);
});

fastify.get('/oauthRedirect', async (request, reply) => {
  const { code } = request.query;

  if (!code) return reply.status(400).send('Missing authorization code.');

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
      return reply.status(res.status).send(`Token exchange failed: ${data.error_description || JSON.stringify(data)}`);
    }

    const data = await res.json();

    request.session.access_token = data.access_token;
    request.session.refresh_token = data.refresh_token;
    request.session.expires_at = Date.now() + data.expires_in * 1000;
    await request.session.save();

    fastify.log.info('Onshape access token saved to session.');

    return reply.redirect('/');
  } catch (err) {
    fastify.log.error('OAuth redirect error:', err);
    return reply.status(500).send('Onshape token exchange failed due to server error.');
  }
});

fastify.get('/listDocuments', { preHandler: ensureValidToken }, async (request, reply) => {
    fastify.log.info(`Listing documents with access token: ${request.session.access_token ? 'present' : 'missing'}`);

  try {
    const res = await fetch(`${ONSHAPE_API_BASE_URL}/documents`, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const error = await res.json();
      fastify.log.error('Error fetching documents:', error);
      return reply.status(res.status).send(`Failed to fetch documents: ${error.message}`);
    }

    const documents = await res.json();
    return reply.view('documents.hbs', { documents });
  } catch (err) {
    fastify.log.error('Error fetching documents:', err);
    return reply.status(500).send('Server error while fetching documents.');
  }
});

// --- Start the server ---
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log(`Server running on port ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
