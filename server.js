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
    sameSite: 'none', // Recommended for security against CSRF - was 'lax'
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
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;", // Re-evaluate 'unsafe-inline' later if possible
    "style-src 'self' 'unsafe-inline';", // Re-evaluate 'unsafe-inline' later if possible
    "img-src 'self' data:;",
    // IMPORTANT: Add your Supabase project URL here for API calls
    "connect-src 'self' https://cad.onshape.com https://api.onshape.com https://fktxolwcqbwovlbfxevx.supabase.co https://fktxolwcqbwovlbfxevx.functions.supabase.co;",
    // This allows Onshape to embed your app. Your side of the CSP is okay here.
    "frame-ancestors 'self' https://cad.onshape.com https://*.onshape.com;",
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




// server.js

// Add this DELETE route
fastify.delete('/notes', async (request, reply) => {
    if (!request.session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = request.session.user.id;
    const { noteIds } = request.body; // Expect an array of note IDs

    if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
        return reply.status(400).send({ error: 'No note IDs provided for deletion.' });
    }

    try {
        // IMPORTANT SECURITY STEP: Ensure the user owns all notes they are trying to delete.
        // First, check if all provided noteIds belong to the current user.
        const { data: userNotes, error: fetchError } = await supabase
            .from('notes')
            .select('id')
            .in('id', noteIds)
            .eq('user_id', userId);

        if (fetchError) {
            fastify.log.error('Error verifying note ownership for deletion:', fetchError);
            return reply.status(500).send({ error: 'Failed to verify note ownership.' });
        }

        const ownedNoteIds = userNotes.map(note => note.id);
        const unownedNoteIds = noteIds.filter(id => !ownedNoteIds.includes(id));

        if (unownedNoteIds.length > 0) {
            fastify.log.warn(`User ${userId} attempted to delete unowned notes: ${unownedNoteIds.join(', ')}`);
            // You can choose to return an error or proceed with only owned notes.
            // For security, it's safer to either error out or only delete the owned ones explicitly.
            // Let's error out to be strict, or filter and proceed. Filtering is more user-friendly.
            // For now, let's just proceed with owned notes, but log the warning.
            // If you want strict: return reply.status(403).send({ error: 'Attempted to delete notes not owned by user.' });
        }

        // Filter out any unowned notes from the deletion list
        const notesToDelete = ownedNoteIds;

        if (notesToDelete.length === 0) {
             return reply.status(400).send({ error: 'No valid notes to delete or all selected notes are unowned.' });
        }

        // Perform the deletion
        const { error: deleteError } = await supabase
            .from('notes')
            .delete()
            .in('id', notesToDelete)
            .eq('user_id', userId); // Extra layer of security

        if (deleteError) {
            fastify.log.error('Error deleting notes from Supabase:', deleteError);
            return reply.status(500).send({ error: 'Failed to delete notes.' });
        }

        // After deletion, if the currently active note was deleted,
        // we should probably set a new active note (e.g., the most recent one remaining, or an empty one).
        // This is important to prevent the main page from trying to load a deleted note.
        // For simplicity, for now, we'll let the frontend handle reloading and picking a new active note.
        // If the *active* note was deleted, a subsequent loadNotes call on the main page will handle it.

        fastify.log.info(`User ${userId} successfully deleted notes: ${notesToDelete.join(', ')}`);
        return reply.status(200).send({ message: 'Notes deleted successfully.', deletedCount: notesToDelete.length });

    } catch (e) {
        fastify.log.error('Exception in DELETE /notes:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
    }
});






// Existing POST /notes route - MODIFY THIS
fastify.post('/notes', async (request, reply) => {
    if (!request.session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = request.session.user.id;
    const { content } = request.body;

    fastify.log.info(`DEBUG POST /notes: User ${userId}, Content length: ${content ? content.length : 0}, Content snippet: "${content ? content.substring(0, 20) : 'null/undefined'}"`);


    if (content === undefined || content === null) {
        return reply.status(400).send({ error: 'Note content is required.' });
    }

    try {
        // First, try to find the *active* note for this user
        const { data: existingNotes, error: findError } = await supabase
            .from('notes')
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true); // Look for the active note

        if (findError) {
            fastify.log.error('Error finding active note:', findError);
            return reply.status(500).send({ error: 'Failed to check for existing note.' });
        }

        if (existingNotes && existingNotes.length > 0) {
            // An active note already exists, so UPDATE its content
            const activeNoteId = existingNotes[0].id;
            const { data, error: updateError } = await supabase
                .from('notes')
                .update({ content: content })
                .eq('id', activeNoteId)
                .eq('user_id', userId); // Ensure the user owns this note for security

            if (updateError) {
                fastify.log.error('Error updating existing active note:', updateError);
                return reply.status(500).send({ error: 'Failed to update note.' });
            }
            fastify.log.info(`Updated active note (ID: ${activeNoteId}) for user ${userId}.`);
            return reply.status(200).send({ message: 'Note updated successfully.' });

        } else {
            // No active note found, so INSERT a new one as the active note
            const { data, error: insertError } = await supabase
                .from('notes')
                .insert({ user_id: userId, content: content, is_active: true });

            if (insertError) {
                fastify.log.error('Error inserting new active note:', insertError);
                return reply.status(500).send({ error: 'Failed to save new note.' });
            }
            fastify.log.info(`Created new active note for user ${userId}.`);
            return reply.status(200).send({ message: 'New note created successfully.' });
        }

    } catch (e) {
        fastify.log.error('Exception in POST /notes:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
    }
});


// In your server.js file, find and replace your existing GET /notes route with this:

fastify.get('/notes', async (request, reply) => {
    if (!request.session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = request.session.user.id;
    // Get the note ID from the query string, e.g., /notes?id=some-uuid
    const noteIdToLoad = request.query.id; 

    try {
        if (noteIdToLoad) {
            // CASE 1: A specific note ID is requested via the URL query
            fastify.log.info(`Attempting to load specific note ID: ${noteIdToLoad} for user ${userId}`);

            // First, verify that the requested note exists and belongs to the current user
            const { data: requestedNoteCheck, error: checkError } = await supabase
                .from('notes')
                .select('id')
                .eq('id', noteIdToLoad)
                .eq('user_id', userId)
                .single(); // Use .single() as we expect one or none

            if (checkError || !requestedNoteCheck) {
                // If note is not found, or user doesn't own it
                fastify.log.error(`Note ${noteIdToLoad} not found or not owned by user ${userId}:`, checkError);
                return reply.status(404).send({ error: 'Note not found or unauthorized.' });
            }

            // Step 1: Deactivate any current active notes for this user
            // This ensures only one note is 'active' at a time.
            const { error: deactivateError } = await supabase
                .from('notes')
                .update({ is_active: false })
                .eq('user_id', userId)
                .eq('is_active', true);

            if (deactivateError) {
                fastify.log.warn('Could not deactivate old active notes (may not exist):', deactivateError);
                // We log a warning but continue, as the main goal is to activate the requested note.
            }

            // Step 2: Set the requested note as the new active note
            const { data: activatedNote, error: activateError } = await supabase
                .from('notes')
                .update({ is_active: true })
                .eq('id', noteIdToLoad)
                .eq('user_id', userId) // Security: Re-confirm user owns it for this update
                .select('*') // Select the activated note to return its full data
                .single(); // Expecting one updated row

            if (activateError || !activatedNote) {
                fastify.log.error(`Error activating note ${noteIdToLoad}:`, activateError);
                return reply.status(500).send({ error: 'Failed to activate note.' });
            }

            fastify.log.info(`Activated note ${noteIdToLoad} for user ${userId}.`);
            return reply.status(200).send(activatedNote);

        } else {
            // CASE 2: No specific note ID provided, return the currently active note
            fastify.log.info(`Fetching current active note for user ${userId} (no specific ID requested).`);
            const { data: activeNotes, error: findActiveError } = await supabase
                .from('notes')
                .select('*')
                .eq('user_id', userId)
                .eq('is_active', true)
                .limit(1); // Only interested in the first active note

            if (findActiveError) {
                fastify.log.error('Error finding active note:', findActiveError);
                return reply.status(500).send({ error: 'Failed to retrieve active note.' });
            }

            if (activeNotes && activeNotes.length > 0) {
                fastify.log.info(`Active note (ID: ${activeNotes[0].id}) found for user ${userId}.`);
                return reply.status(200).send(activeNotes[0]);
            } else {
                // No active note found. Return an empty content so the frontend clears the textarea.
                // The frontend can then decide to trigger a new note creation or display empty.
                fastify.log.info(`No active note found for user ${userId}. Returning empty content.`);
                return reply.status(200).send({ content: '' });
            }
        }

    } catch (e) {
        fastify.log.error('Exception in GET /notes:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
    }
});


// In your server.js file, add this new route:

fastify.post('/notes/new', async (request, reply) => {
    if (!request.session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = request.session.user.id;
    // For a new note, we typically start with empty content.
    // However, if your frontend *could* send initial content, allow it.
    const initialContent = request.body.content || ''; 

    fastify.log.info(`Attempting to create new note for user ${userId}.`);

    try {
        // Step 1: Deactivate the current active note for this user
        // This ensures only one note is 'active' at any given time.
        const { error: deactivateError } = await supabase
            .from('notes')
            .update({ is_active: false })
            .eq('user_id', userId)
            .eq('is_active', true); // Crucially, only deactivate the currently active one

        if (deactivateError) {
            // Log this, but don't necessarily abort. 
            // It might be fine if there was no active note to deactivate.
            fastify.log.warn('Could not deactivate old active note (might not exist):', deactivateError);
        } else {
            fastify.log.info(`Deactivated previous active note for user ${userId}.`);
        }

        // Step 2: Insert a brand new note and set it as active
        const { data: newNote, error: insertError } = await supabase
            .from('notes')
            .insert({ user_id: userId, content: initialContent, is_active: true })
            .select(); // Use .select() to get the newly created row data, including its ID

        if (insertError) {
            fastify.log.error('Error inserting new active note:', insertError);
            return reply.status(500).send({ error: 'Failed to create new note.' });
        }

        const newNoteId = newNote && newNote.length > 0 ? newNote[0].id : 'N/A';
        fastify.log.info(`Created new active note (ID: ${newNoteId}) for user ${userId}.`);
        
        // Return the new note data so the frontend can update its state if needed
        return reply.status(201).send({ message: 'New note created successfully.', note: newNote[0] });

    } catch (e) {
        fastify.log.error('Exception in POST /notes/new:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
    }
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




// In your server.js file, find and update your existing GET /documents route:

fastify.get('/documents', async (request, reply) => {
    if (!request.session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = request.session.user.id;

    fastify.log.info(`Attempting to retrieve all notes for Supabase user_id: ${userId}`);

    try {
        const { data: allNotes, error: findError } = await supabase
            .from('notes')
            .select('id, content, created_at, is_active') // <-- IMPORTANT: Added 'id' and 'is_active'
            .eq('user_id', userId)
            .order('created_at', { ascending: false }); // Order by creation date, newest first

        if (findError) {
            fastify.log.error('Error retrieving all notes:', findError);
            return reply.status(500).send({ error: 'Failed to retrieve notes list.' });
        }

        fastify.log.info(`Notes retrieved for Supabase user ${userId}. Count: ${allNotes ? allNotes.length : 0}`);

        // Prepare notes data for rendering in the Handlebars template
        const notesForDisplay = allNotes.map(note => ({
            id: note.id, // Pass the ID to the template
            // Truncate content for display if it's too long
            content: note.content ? note.content.substring(0, 100) + (note.content.length > 100 ? '...' : '') : '(Empty Note)',
            createdAt: new Date(note.created_at).toLocaleString(), // Format date nicely
            isActive: note.is_active // Pass active status to the template
        }));

        // Render the documents page with the notes data
        return reply.view('documents.hbs', { notes: notesForDisplay, user: request.session.user });

    } catch (e) {
        fastify.log.error('Exception in GET /documents:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
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
