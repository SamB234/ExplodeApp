import Fastify from 'fastify';
import FastifyCookie from '@fastify/cookie';
import FastifySession from '@fastify/session';
import FastifyFormbody from '@fastify/formbody';
import FastifyView from '@fastify/view';
import PointOfView from 'point-of-view';
import handlebars from 'handlebars';
import fetch from 'node-fetch';
import path from 'path';
import FastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fastify = Fastify({ logger: true });

const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api';

fastify.register(FastifyFormbody);
fastify.register(FastifyCookie);
fastify.register(FastifySession, {
  secret: 'a very secure secret',
  cookie: { secure: false }, // Set to true if using HTTPS
  saveUninitialized: false,
});

fastify.register(FastifyView, {
  engine: { handlebars },
  templates: 'views',
});

fastify.register(FastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
});

// Homepage
fastify.get('/', async (request, reply) => {
  return reply.view('home.hbs');
});

// Embedded app launch point
fastify.get('/app', async (request, reply) => {
  const { accessToken, documentId, workspaceId, elementId } = request.query;

  if (!accessToken || !documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing required parameters.');
  }

  return reply.view('assembly_view.hbs', {
    accessToken,
    d: documentId,
    w: workspaceId,
    e: elementId,
  });
});

// Fetch exploded assembly data
fastify.get('/api/assemblydata', async (request, reply) => {
  try {
    const { d, w, e, accessToken } = request.query;

    if (!d || !w || !e || !accessToken) {
      fastify.log.warn('Missing document context parameters');
      return reply.status(400).send('Missing document context parameters.');
    }

    const assemblyUrl = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}/explode`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };

    const onshapeResponse = await fetch(assemblyUrl, { headers });

    if (!onshapeResponse.ok) {
      const errorText = await onshapeResponse.text();
      fastify.log.error(`Onshape API error: ${errorText}`);
      return reply.status(onshapeResponse.status).send(`Error fetching assembly data: ${errorText}`);
    }

    const assemblyData = await onshapeResponse.json();
    reply.send(assemblyData);
  } catch (error) {
    fastify.log.error('Error in /api/assemblydata:', error);
    reply.status(500).send('Internal Server Error');
  }
});

// Fetch glTF model
fastify.get('/api/gltf-model', async (request, reply) => {
  try {
    const { d, w, e, accessToken } = request.query;

    if (!d || !w || !e || !accessToken) {
      fastify.log.warn('Missing document context parameters for /api/gltf-model');
      return reply.status(400).send('Missing document context parameters.');
    }

    const gltfUrl = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}/gltf`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };

    fastify.log.info(`Fetching glTF model from: ${gltfUrl}`);
    const onshapeResponse = await fetch(gltfUrl, { headers });

    if (!onshapeResponse.ok) {
      const errorText = await onshapeResponse.text();
      fastify.log.error(`Onshape glTF fetch error: ${errorText}`);
      return reply.status(onshapeResponse.status).send(`Error fetching glTF model: ${errorText}`);
    }

    const gltfData = await onshapeResponse.json();
    reply.send(gltfData);
  } catch (error) {
    fastify.log.error('Error in /api/gltf-model:', error);
    reply.status(500).send('Internal Server Error fetching glTF model.');
  }
});

// NEW: Fetch parts from Part Studio
fastify.get('/api/parts', async (request, reply) => {
  try {
    const { d, w, e, accessToken } = request.query;

    if (!d || !w || !e || !accessToken) {
      fastify.log.warn('Missing document context parameters for /api/parts');
      return reply.status(400).send('Missing document context parameters.');
    }

    const partsUrl = `${ONSHAPE_API_BASE_URL}/parts/d/${d}/w/${w}/e/${e}`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };

    fastify.log.info(`Fetching parts from: ${partsUrl}`);
    const onshapeResponse = await fetch(partsUrl, { headers });

    if (!onshapeResponse.ok) {
      const errorText = await onshapeResponse.text();
      fastify.log.error(`Parts fetch error: ${errorText}`);
      return reply.status(onshapeResponse.status).send(`Error fetching parts: ${errorText}`);
    }

    const partsData = await onshapeResponse.json();
    reply.send(partsData);
  } catch (error) {
    fastify.log.error('Error in /api/parts:', error);
    reply.status(500).send('Internal Server Error fetching parts data.');
  }
});

// Launch server
const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    fastify.log.info('Server running at http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
