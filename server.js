const path = require('path');
//const fastify = require('fastify')({ logger: true });
const fastify = require('fastify')({ logger: true, trustProxy: true });

const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const fastifyCookie = require('@fastify/cookie');
const fastifySession = require('@fastify/session');
const handlebars = require('handlebars');
const fetch = require('node-fetch');

require('dotenv').config();


//const supabase = createClient(
  //'https://fktxolwcqbwovlbfxevx.supabase.co',
  //process.env.SUPABASE_KEY
//);


const { createClient } = require('@supabase/supabase-js');  // <--- Add this!

// ... your other setup and supabase client init
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);



const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6';

handlebars.registerHelper('json', function (context) {
  return JSON.stringify(context, null, 2);
});

fastify.register(fastifyCookie);
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET || 'a-very-secret-key',
  cookie: {
   // secure: true,
    secure: process.env.NODE_ENV === 'production', // true for HTTPS only
    httpOnly: true,
    sameSite: 'lax',
    },  //false 10.07.25
  
  saveUninitialized: false,

});


fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
});

/*
// ✅ Add this after the last fastify.register
fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('Content-Security-Policy', 'frame-ancestors https://cad.onshape.com');
  reply.header('X-Frame-Options', ''); // Optional: explicitly clears it
  return payload;
});
*/

fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('Content-Security-Policy', [
    "default-src 'self';",
   // "script-src 'self' 'unsafe-inline';", 
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;",
    "style-src 'self' 'unsafe-inline';",
    "img-src 'self' data:;",
    "connect-src 'self' https://cad.onshape.com;",
   // "frame-ancestors https://*.onshape.com;"
    "frame-ancestors 'self' https://cad.onshape.com https://*.onshape.com;",
  ].join(' '));
  
 // reply.header('X-Frame-Options', 'ALLOW-FROM https://cad.onshape.com'); // Optional, legacy
  return payload;
});


fastify.register(fastifyFormbody);

fastify.register(fastifyView, {
  engine: { handlebars },
  root: path.join(__dirname, 'src/pages'),
  layout: false,
});


// Define helper to get user by ID
async function getUser(userId) {
  return await prisma.user.findUnique({
    where: { id: userId },
  });
}

async function ensureValidToken(request, reply, done) {
  const session = request.session;
  if (!session || !session.access_token || !session.expires_at) {
    return reply.redirect('/oauthStart');
  }




  const user = await usersCollection.findOne({ _id: new ObjectId(request.session.userId) });
  if (!user) {
    throw new Error('User not found');
  }

  return user;
}


  
  const now = Date.now();
  if (now > session.expires_at - 60000) {
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
        return reply.redirect('/oauthStart');
      }

      const data = await res.json();
      session.access_token = data.access_token;
      session.refresh_token = data.refresh_token || session.refresh_token;
      session.expires_at = Date.now() + data.expires_in * 1000;
      await session.save();
    } catch (err) {
      fastify.log.error('Error refreshing token:', err);
      return reply.redirect('/oauthStart');
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


/*
fastify.get('/', async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);

  if (!request.session.access_token) {
    return reply.view('index.hbs', {
      title: 'Onshape Exploded View App',
      message: 'Please authorize the app first.',
      oauthUrl: '/oauthStart',
    });
  }
  */

fastify.get('/', async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  const accessToken = request.session.access_token || request.query.accessToken;

  if (!request.session.access_token && request.query.accessToken) {
  request.session.access_token = request.query.accessToken;
  await request.session.save();  // add this
  
    fastify.log.info('Saved session:', {
  access_token: request.session.access_token
});
    
}
 
  if (!accessToken) {
    return reply.view('index.hbs', {
      title: 'Notes',
      message: 'Please authorize the app first.',
      oauthUrl: '/oauthStart',
    });
  }

  return reply.view('assembly_view.hbs', {
    title: 'Exploded View',
    documentId,
    workspaceId,
    elementId,
    accessToken: request.session.access_token,
  });
});

fastify.get('/api/assemblydata', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Using access token: ${request.session.access_token}`);

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
  fastify.log.info(`Using access token: ${request.session.access_token}`);

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

// 🔧 New: Exploded view config
fastify.get('/api/exploded-config', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Using access token: ${request.session.access_token}`);

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

// 🔧 New: Mates
fastify.get('/api/mates', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Using access token: ${request.session.access_token}`);

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
  const state = 'state123';
  fastify.log.info(`Using access token: ${request.session.access_token}`);

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
  const { code } = request.query;
  fastify.log.info(`Using access token: ${request.session.access_token}`);

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
      fastify.log.error('Token exchange failed:', res.status, data);
      return reply.status(res.status).send(`Token exchange failed: ${data.error_description || JSON.stringify(data)}`);
    }

    const data = await res.json();

    request.session.access_token = data.access_token;
    request.session.refresh_token = data.refresh_token;
    request.session.expires_at = Date.now() + data.expires_in * 1000;
    await request.session.save();

fastify.log.info('Saved session:', {
  access_token: request.session.access_token
});


    return reply.redirect('/');
  } catch (err) {
    fastify.log.error('OAuth redirect error:', err);
    return reply.status(500).send('Token exchange failed due to server error.');
  }
});




fastify.get('/listDocuments', { preHandler: ensureValidToken }, async (request, reply) => {
    fastify.log.info(`Using access token: ${request.session.access_token}`);

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





fastify.post('/signup', async (request, reply) => {
  const { email, password } = request.body;

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return reply.code(400).send({ error: error.message });
  }

  reply.send({ message: 'Check your email to confirm your account.' });
});

fastify.post('/login', async (request, reply) => {
  const { email, password } = request.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return reply.code(400).send({ error: error.message });
  }

  reply.send({ user: data.user });
});



fastify.get('/notes', async (request, reply) => {
  try {
    const user = await getUser(request, usersCollection); // ✅ same here
    reply.send({ notes: user.notes || '' });
  } catch (err) {
    request.log.error(err);
    reply.status(500).send({ error: 'Failed to fetch note' });
  }
});




fastify.post('/notes', async (request, reply) => {
  try {
    const user = await getUser(request, usersCollection); // ✅ now defined
    const { content } = request.body;

    await usersCollection.updateOne(
      { _id: new ObjectId(user._id) },
      { $set: { notes: content } }
    );

    reply.send({ success: true });
  } catch (err) {
    request.log.error(err);
    reply.status(500).send({ error: 'Failed to save note' });
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
