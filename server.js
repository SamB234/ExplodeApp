const path = require('path');
const fastify = require('fastify')({ logger: true });
const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const handlebars = require('handlebars');
const fetch = require('node-fetch');

require('dotenv').config();

const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6'; // Base URL for Onshape REST API

// A simple in-memory store for the access token (FOR DEMO/TESTING ONLY - NOT SECURE FOR PROD)
// In a real application, you would use server-side sessions or a database to store this securely.
// This specific token is for the general OAuth flow (e.g., /listDocuments).
let currentUserAccessToken = null;

// Global variables to store context and the short-lived token from an Onshape Connected App launch (FOR DEMO/TESTING ONLY)
// These will be populated when the app loads inside an Onshape document.
let documentContextAccessToken = null;
let currentDocumentId = null;
let currentWorkspaceId = null;
let currentElementId = null;

// Register Handlebars helper for JSON stringification in templates
handlebars.registerHelper('json', function(context) {
    return JSON.stringify(context, null, 2);
});

// Register plugins
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
});

fastify.register(fastifyFormbody);

fastify.register(fastifyView, {
  engine: { handlebars },
  root: path.join(__dirname, 'src/pages'),
  layout: false,
});

// Helper function to fetch assembly definition
// This function will be called when the app is launched from an Onshape assembly tab
async function fetchAssemblyDefinition(documentId, workspaceId, elementId, accessToken) {
  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/assemblydefinition`;
  fastify.log.info(`Attempting to fetch assembly definition from: ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`, // Use the Onshape-provided token
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorBody = await response.text(); // Get text to see full error from Onshape
    fastify.log.error(`Onshape API response error (${response.status}): ${errorBody}`);
    throw new Error(`Onshape API error ${response.status}: ${errorBody}`);
  }

  return await response.json();
}


// Serve homepage - This route now acts as the entry point for both direct browser access
// and Connected App launches from Onshape.
fastify.get('/', async (request, reply) => {
  // Check if Onshape has passed contextual parameters (typical for Connected Apps)
  // Onshape's Connected App parameters are often single letters: d, w, e.
  const { d, w, e, accessToken, onshapeOAuthRedirectUri } = request.query;

  if (d && w && e && accessToken) {
    // This is a launch from within Onshape, passing document context
    fastify.log.info(`App launched from Onshape. Doc: ${d}, Workspace: ${w}, Elem: ${e}`);

    // Store the context and access token globally (FOR DEMO ONLY - use session in production!)
    currentDocumentId = d;
    currentWorkspaceId = w;
    currentElementId = e;
    documentContextAccessToken = accessToken; // This is the short-lived Onshape-provided token

    // Now, attempt to fetch assembly data using this context
    try {
      const assemblyData = await fetchAssemblyDefinition(d, w, e, accessToken);
      // Render the assembly_view.hbs template with the fetched data
      return reply.view('assembly_view.hbs', {
        title: 'Exploded View',
        assemblyData: assemblyData,
        documentId: d,
        workspaceId: w,
        elementId: e
      });
    } catch (apiError) {
      fastify.log.error('Error fetching assembly definition in /:', apiError);
      return reply.view('error.hbs', {
        title: 'Error loading assembly',
        message: 'Could not load assembly data from Onshape.',
        error: apiError.message
      });
    }

  } else {
    // This is a direct browser access to your Glitch app's root URL (not launched from within Onshape)
    return reply.view('index.hbs', {
      title: 'Onshape Exploded View App',
      message: 'To use this app, open it from an Onshape document (via the Applications menu).'
    });
  }
});


// Start OAuth - This route is for initiating the general OAuth flow (e.g., if a user just wants to list documents)
fastify.get('/oauthStart', async (request, reply) => {
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const redirectUri = process.env.ONSHAPE_REDIRECT_URI;
  const scope = 'OAuth2ReadPII OAuth2Read OAuth2Write';
  const state = 'state123'; // IMPORTANT: You should randomize this and store it in session for CSRF protection

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

  const authUrl = `${ONSHAPE_AUTH_URL}?${params.toString()}`;
  return reply.redirect(authUrl);
});

// OAuth redirect - handles the callback from Onshape after user authorization for the general flow
fastify.get('/oauthRedirect', async (request, reply) => {
  const { code, state } = request.query;

  if (!code) {
    return reply.status(400).send('Missing authorization code in redirect.');
  }

  // IMPORTANT: In a real app, validate the 'state' parameter here to prevent CSRF attacks
  // if (state !== storedStateFromSession) {
  //   return reply.status(403).send('Invalid state parameter. Possible CSRF attack.');
  // }

  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;
  const redirectUri = process.env.ONSHAPE_REDIRECT_URI;

  try {
    const response = await fetch(ONSHAPE_TOKEN_URL, {
      method: 'POST',
      headers: {
        // Onshape expects Client ID and Client Secret in Basic Auth header for token exchange
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(), // URLSearchParams automatically encodes the body
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Token exchange error:', response.status, data);
      return reply.status(response.status).send(`Token exchange failed: ${data.error_description || JSON.stringify(data)}`);
    }

    // Store the access token for subsequent API calls (FOR DEMO ONLY)
    // This `currentUserAccessToken` is for the general app, not the in-context app.
    currentUserAccessToken = data.access_token;
    // For a real application, you'd store data.refresh_token as well and associate it with a user session.

    // Redirect to the listDocuments page after successful general authorization
    return reply.redirect('/listDocuments');

  } catch (err) {
    console.error('OAuth redirect error during token exchange:', err);
    return reply.status(500).send('Token exchange failed due to a server error.');
  }
});

// New route to list Onshape documents - still useful for standalone document listing
fastify.get('/listDocuments', async (request, reply) => {
  if (!currentUserAccessToken) {
    return reply.status(401).send('No active access token. Please authorize the app first by visiting /oauthStart.');
  }

  try {
    const response = await fetch(`${ONSHAPE_API_BASE_URL}/documents`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${currentUserAccessToken}`, // Use the obtained access token
        'Accept': 'application/json' // Request JSON response
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Onshape API Error (listDocuments):', response.status, errorData);
      return reply.status(response.status).send(`Failed to fetch documents: ${errorData.message || JSON.stringify(errorData)}`);
    }

    const documents = await response.json();

    // Render the Handlebars template for documents
    return reply.view('documents.hbs', { documents: documents }); // Pass the 'documents' array to the template

  } catch (err) {
    console.error('Error fetching documents from Onshape API:', err);
    return reply.status(500).send('Failed to fetch documents from Onshape API due to a server error.');
  }
});


// Start server
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    fastify.log.info(`Server running on port ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
