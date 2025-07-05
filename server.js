const path = require('path');
const fastify = require('fastify')({ logger: true });
const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const handlebars = require('handlebars');
const fetch = require('node-fetch');

require('dotenv').config();

const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6';

// Register Handlebars helper for JSON stringification
handlebars.registerHelper('json', function(context) {
    return JSON.stringify(context, null, 2);
});

// Register Fastify plugins
fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/public/',
});
fastify.register(fastifyFormbody);
fastify.register(fastifyView, {
    engine: { handlebars },
    root: path.join(__dirname, 'src/pages'),
});

/**
 * Route to handle the launch of the Integrated App from an Onshape document.
 * Onshape sends a POST request with a JSON body containing the document context.
 */
fastify.post('/', async (request, reply) => {
    // The context for an Integrated App is sent in the request body
    const { documentId, workspaceId, elementId, accessToken } = request.body;

    if (documentId && workspaceId && elementId && accessToken) {
        fastify.log.info(`Integrated App launched. Doc: ${documentId}, Workspace: ${workspaceId}, Elem: ${elementId}`);

        // Render the main application view, passing the necessary IDs and the accessToken
        return reply.view('assembly_view.hbs', {
            title: 'Exploded View (Integrated App)',
            documentId,
            workspaceId,
            elementId,
            accessToken
        });
    } else {
        // Log a warning if the expected context is missing
        fastify.log.warn('Received a POST request to / but the required Onshape context was missing.');
        return reply.status(400).send('Bad Request: Missing Onshape context in request body.');
    }
});

/**
 * Fallback GET route for users accessing the app's URL directly.
 * This provides instructions on how to use the app correctly.
 */
fastify.get('/', (request, reply) => {
    return reply.view('index.hbs', {
        title: 'Onshape Integrated App',
        message: 'This is an Onshape Integrated App. Please launch it from within an Onshape document.'
    });
});

/**
 * Server-side proxy to fetch assembly definition from the Onshape API.
 * This approach keeps your API credentials secure on the server.
 */
fastify.get('/api/assemblydata', async (request, reply) => {
    try {
        const { d, w, e, accessToken } = request.query;

        if (!d || !w || !e || !accessToken) {
            fastify.log.warn('Missing required parameters for /api/assemblydata');
            return reply.status(400).send('Missing document context parameters.');
        }

        const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}`;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        };

        fastify.log.info(`Fetching assembly definition from: ${url}`);
        const onshapeResponse = await fetch(url, { headers });

        if (!onshapeResponse.ok) {
            const errorText = await onshapeResponse.text();
            fastify.log.error(`Onshape API Error (${url} - ${onshapeResponse.status}): ${errorText}`);
            return reply.status(onshapeResponse.status).send(`Error from Onshape API: ${errorText}`);
        }

        const assemblyData = await onshapeResponse.json();
        reply.send(assemblyData);

    } catch (error) {
        fastify.log.error('Error in /api/assemblydata:', error);
        reply.status(500).send('Internal Server Error.');
    }
});

/**
 * Server-side proxy to fetch the GLTF model from the Onshape API.
 */
fastify.get('/api/gltf-model', async (request, reply) => {
    try {
        const { d, w, e, accessToken } = request.query;

        if (!d || !w || !e || !accessToken) {
            fastify.log.warn('Missing required parameters for /api/gltf-model');
            return reply.status(400).send('Missing document context parameters for GLTF model.');
        }

        const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}/gltf?mode=flat`;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'model/gltf+json'
        };

        fastify.log.info(`Fetching GLTF model from: ${url}`);
        const onshapeResponse = await fetch(url, { headers });

        if (!onshapeResponse.ok) {
            const errorText = await onshapeResponse.text();
            fastify.log.error(`Onshape API Error (${url} - ${onshapeResponse.status}): ${errorText}`);
            return reply.status(onshapeResponse.status).send(`Error fetching GLTF: ${errorText}`);
        }

        reply.type('model/gltf+json');
        reply.send(onshapeResponse.body);

    } catch (error) {
        fastify.log.error('Error in /api/gltf-model:', error);
        reply.status(500).send('Internal Server Error fetching GLTF model.');
    }
});

// Function to start the server
const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
        fastify.log.info(`Server listening on port ${fastify.server.address().port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
