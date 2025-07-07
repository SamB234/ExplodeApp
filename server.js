const path = require('path');
const fastify = require('fastify')({ logger: true });
const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const handlebars = require('handlebars');
const fetch = require('node-fetch');
const stream = require('stream');

require('dotenv').config();

const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6';

let currentUserAccessToken = null;

handlebars.registerHelper('json', function(context) {
    return JSON.stringify(context, null, 2);
});

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

fastify.get('/', async (request, reply) => {
    const { d, w, e, accessToken } = request.query;

    if (d && w && e && accessToken) {
        fastify.log.info(`App launched from Onshape. Doc: ${d}, Workspace: ${w}, Elem: ${e}`);
        return reply.view('assembly_view.hbs', {
            title: 'Exploded View',
            documentId: d,
            workspaceId: w,
            elementId: e,
            accessToken
        });
    } else {
        return reply.view('index.hbs', {
            title: 'Onshape Exploded View App',
            message: 'To use this app, open it from an Onshape document (via the Applications menu).'
        });
    }
});

fastify.get('/api/assemblydata', async (request, reply) => {
    try {
        const { d, w, e, accessToken } = request.query;

        if (!d || !w || !e || !accessToken) {
            return reply.status(400).send('Missing document context parameters.');
        }

        const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}/assemblydefinition`;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        };

        const res = await fetch(url, { headers });

        if (!res.ok) {
            const errorText = await res.text();
            fastify.log.error(`Onshape API error: ${res.status} ${errorText}`);
            return reply.status(res.status).send(`Error: ${errorText}`);
        }

        const data = await res.json();
        reply.send(data);

    } catch (err) {
        fastify.log.error('Error in /api/assemblydata:', err);
        reply.status(500).send('Internal Server Error.');
    }
});

fastify.get('/api/gltf-model', async (request, reply) => {
    try {
        const { d, w, e, accessToken } = request.query;

        if (!d || !w || !e || !accessToken) {
            return reply.status(400).send('Missing document context parameters for GLTF model.');
        }

        const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}/gltf?outputFacetSettings=true&mode=flat`;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'model/gltf+json'
        };

        const res = await fetch(url, { headers });

        if (!res.ok) {
            const errorText = await res.text();
            fastify.log.error(`GLTF fetch failed: ${res.status} ${errorText}`);
            return reply.status(res.status).send(`Error fetching GLTF: ${errorText}`);
        }

        reply.header('Content-Type', 'model/gltf+json');

        const readable = stream.Readable.fromWeb(res.body);
        return reply.send(readable);

    } catch (err) {
        fastify.log.error('Error in /api/gltf-model:', err);
        reply.status(500).send('Internal Server Error fetching GLTF model.');
    }
});

fastify.get('/oauthStart', async (request, reply) => {
    const clientId = process.env.ONSHAPE_CLIENT_ID;
    const redirectUri = process.env.ONSHAPE_REDIRECT_URI;
    const scope = 'OAuth2ReadPII OAuth2Read OAuth2Write';
    const state = 'state123';

    if (!clientId || !redirectUri) {
        return reply.status(500).send('Missing ONSHAPE_CLIENT_ID or ONSHAPE_REDIRECT_URI.');
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
    const { code, state } = request.query;

    if (!code) return reply.status(400).send('Missing authorization code.');

    const clientId = process.env.ONSHAPE_CLIENT_ID;
    const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;
    const redirectUri = process.env.ONSHAPE_REDIRECT_URI;

    try {
        const res = await fetch(ONSHAPE_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
            }),
        });

        const data = await res.json();

        if (!res.ok) {
            fastify.log.error('Token exchange failed:', res.status, data);
            return reply.status(res.status).send(`Token exchange failed: ${data.error_description || JSON.stringify(data)}`);
        }

        currentUserAccessToken = data.access_token;
        return reply.redirect('/listDocuments');

    } catch (err) {
        fastify.log.error('OAuth redirect error:', err);
        reply.status(500).send('Token exchange failed due to server error.');
    }
});

fastify.get('/listDocuments', async (request, reply) => {
    if (!currentUserAccessToken) {
        return reply.status(401).send('No active access token. Visit /oauthStart to authorize.');
    }

    try {
        const res = await fetch(`${ONSHAPE_API_BASE_URL}/documents`, {
            headers: {
                'Authorization': `Bearer ${currentUserAccessToken}`,
                'Accept': 'application/json'
            }
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
        reply.status(500).send('Server error while fetching documents.');
    }
});

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
