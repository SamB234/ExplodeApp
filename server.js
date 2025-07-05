const path = require('path');
const fastify = require('fastify')({ logger: true });
const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const handlebars = require('handlebars');
const fetch = require('node-fetch'); // Ensure this is installed: npm install node-fetch

require('dotenv').config();

const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6'; // Base URL for Onshape REST API

// A simple in-memory store for the access token (FOR DEMO/TESTING ONLY - NOT SECURE FOR PROD)
// This `currentUserAccessToken` is for the general OAuth flow (e.g., /listDocuments).
// The in-context app will use the accessToken passed in the URL for API calls.
let currentUserAccessToken = null;

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

// Serve homepage - This route now acts as the entry point for both direct browser access
// and Connected App launches from Onshape.
fastify.get('/', async (request, reply) => {
    // Check if Onshape has passed contextual parameters (typical for Connected Apps)
    // Onshape's Connected App parameters are often single letters: d, w, e.
    const { d, w, e, accessToken, onshapeOAuthRedirectUri } = request.query;

    if (d && w && e && accessToken) {
        // This is a launch from within Onshape, passing document context
        fastify.log.info(`App launched from Onshape. Doc: ${d}, Workspace: ${w}, Elem: ${e}`);

        // Render the assembly_view.hbs template. The client-side JS
        // will now use the passed accessToken and IDs to call the new proxy endpoints.
        return reply.view('assembly_view.hbs', {
            title: 'Exploded View',
            documentId: d,
            workspaceId: w,
            elementId: e,
            accessToken: accessToken // Pass accessToken to client-side for API calls
        });
    } else {
        // This is a direct browser access to your app's root URL (not launched from within Onshape)
        return reply.view('index.hbs', {
            title: 'Onshape Exploded View App',
            message: 'To use this app, open it from an Onshape document (via the Applications menu).'
        });
    }
});


// Proxy endpoint to get Assembly Definition
fastify.get('/api/assemblydata', async (request, reply) => {
    try {
        const { d, w, e, accessToken } = request.query; // Get IDs and token from client request
        
        // Basic validation
        if (!d || !w || !e || !accessToken) {
            fastify.log.warn('Missing document context parameters for /api/assemblydata');
            return reply.status(400).send('Missing document context parameters.');
        }

        const assemblyDefinitionUrl = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}/assemblydefinition`;
        const headers = {
            'Authorization': `Bearer ${accessToken}`, // Use the Onshape-provided token
            'Accept': 'application/json' // Request JSON format
        };

        fastify.log.info(`Fetching assembly definition from Onshape API: ${assemblyDefinitionUrl}`);
        const onshapeResponse = await fetch(assemblyDefinitionUrl, { headers: headers });

        if (!onshapeResponse.ok) {
            const errorText = await onshapeResponse.text(); // Get text to see full error from Onshape
            fastify.log.error(`Onshape API response error (${assemblyDefinitionUrl} - ${onshapeResponse.status}): ${errorText}`);
            return reply.status(onshapeResponse.status).send(`Error fetching assembly definition: ${errorText}`);
        }

        const assemblyData = await onshapeResponse.json();
        reply.send(assemblyData); // Send the JSON data back to the client

    } catch (error) {
        fastify.log.error('Error in /api/assemblydata:', error);
        reply.status(500).send('Internal Server Error fetching assembly data.');
    }
});

// Proxy endpoint to get GLTF Model
fastify.get('/api/gltf-model', async (request, reply) => {
    try {
        const { d, w, e, accessToken } = request.query;

        // Basic validation
        if (!d || !w || !e || !accessToken) {
            fastify.log.warn('Missing document context parameters for /api/gltf-model');
            return reply.status(400).send('Missing document context parameters for GLTF model.');
        }

        // Using mode=flat and outputFacetSettings=true are often useful for GLTF exports
        const gltfUrl = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}/gltf?outputFacetSettings=true&mode=flat`;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'model/gltf+json' // Important: Request GLTF JSON format
        };

        fastify.log.info(`Fetching GLTF model from Onshape API: ${gltfUrl}`);
        const onshapeResponse = await fetch(gltfUrl, { headers: headers });

        if (!onshapeResponse.ok) {
            const errorText = await onshapeResponse.text();
            fastify.log.error(`Onshape API response error (${gltfUrl} - ${onshapeResponse.status}): ${errorText}`);
            return reply.status(onshapeResponse.status).send(`Error fetching GLTF: ${errorText}`);
        }

        // Set the Content-Type header to correctly signal GLTF data to the client
        reply.type('model/gltf+json');
        // Stream the GLTF data directly back to the client for efficiency
        reply.send(onshapeResponse.body); // Fastify handles streaming response body if it's a readable stream

    } catch (error) {
        fastify.log.error('Error in /api/gltf-model:', error);
        reply.status(500).send('Internal Server Error fetching GLTF model.');
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
    //    return reply.status(403).send('Invalid state parameter. Possible CSRF attack.');
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
            fastify.log.error('Token exchange error:', response.status, data);
            return reply.status(response.status).send(`Token exchange failed: ${data.error_description || JSON.stringify(data)}`);
        }

        // Store the access token for subsequent API calls (FOR DEMO ONLY)
        // This `currentUserAccessToken` is for the general app, not the in-context app.
        currentUserAccessToken = data.access_token;
        // For a real application, you'd store data.refresh_token as well and associate it with a user session.

        // Redirect to the listDocuments page after successful general authorization
        return reply.redirect('/listDocuments');

    } catch (err) {
        fastify.log.error('OAuth redirect error during token exchange:', err);
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
            fastify.log.error('Onshape API Error (listDocuments):', response.status, errorData);
            return reply.status(response.status).send(`Failed to fetch documents: ${errorData.message || JSON.stringify(errorData)}`);
        }

        const documents = await response.json();

        // Render the Handlebars template for documents
        return reply.view('documents.hbs', { documents: documents }); // Pass the 'documents' array to the template

    } catch (err) {
        fastify.log.error('Error fetching documents from Onshape API:', err);
        reply.status(500).send('Failed to fetch documents from Onshape API due to a server error.');
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
