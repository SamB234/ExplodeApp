// public/script.js

// Using the correct import path for supabaseClient.js from public directory
import { supabase } from '/public/supabaseClient.js';

// --- DOM Elements ---
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const logoutBtn = document.getElementById('logoutBtn');
const noteContentInput = document.getElementById('noteContent'); // The main note textarea

const authSection = document.getElementById('authSection');
const notesSection = document.getElementById('notesSection');

const createNewNoteBtn = document.getElementById('createNewNoteBtn');
const viewAllNotesBtn = document.getElementById('viewAllNotesBtn');

// --- Global State ---
let currentUser = null;
let currentNoteId = null; // Store the ID of the note currently being edited

// --- Utility Functions ---

/**
 * Retrieves a query parameter from the current URL.
 * @param {string} name The name of the query parameter.
 * @returns {string|null} The value of the parameter, or null if not found.
 */
function getQueryParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

/**
 * Toggles the visibility of authentication and notes sections.
 * @param {boolean} loggedIn True if a user is logged in, false otherwise.
 */
function toggleUI(loggedIn) {
    if (authSection && notesSection) {
        if (loggedIn) {
            authSection.classList.add('hidden');
            notesSection.classList.remove('hidden');
        } else {
            authSection.classList.remove('hidden');
            notesSection.classList.add('hidden');
        }
    } else {
        console.warn("UI sections not found. Check your HTML IDs (authSection, notesSection).");
    }
}

// --- API Interaction Functions ---

/**
 * Loads the current note content into the textarea.
 * It prioritizes a note ID from the URL query parameter.
 * If no ID is present, it asks the backend for the user's active note.
 */
async function loadCurrentNote() {
    // Get note ID from URL (e.g., /?id=some-uuid)
    const noteIdFromUrl = getQueryParam('id');
    let url = '/notes'; // Default URL to fetch the active note

    if (noteIdFromUrl) {
        url = `/notes?id=${noteIdFromUrl}`; // Request a specific note
        console.log(`Attempting to load note with ID from URL: ${noteIdFromUrl}`);
    } else {
        console.log('No specific note ID in URL, loading current active note.');
    }

    try {
        const response = await fetch(url, { credentials: 'include' });

        if (!response.ok) {
            // If the requested note isn't found or there's another error,
            // clear the input and log the issue.
            const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
            console.error(`Failed to load note from ${url}: ${response.status} - ${errorData.message}`);
            noteContentInput.value = '';
            currentNoteId = null; // No note loaded
            // If it was a specific ID that failed, redirect to clean URL
            if (noteIdFromUrl) {
                window.history.replaceState({}, document.title, '/');
                alert(`Note with ID ${noteIdFromUrl} not found or inaccessible. Loading default note.`);
                // Recursively call to load the actual active note after cleaning URL
                await loadCurrentNote();
            }
            return;
        }

        const note = await response.json();
        noteContentInput.value = note.content || '';
        currentNoteId = note.id; // Store the ID of the note that was successfully loaded
        console.log(`Note (ID: ${currentNoteId}) loaded successfully.`);
    } catch (error) {
        console.error('Network error loading note:', error);
        noteContentInput.value = 'Error loading note. Please check your connection.';
        currentNoteId = null;
    }
}

/**
 * Saves the content of the textarea to the current active note on the backend.
 */
async function saveNote() {
    if (!currentUser || !noteContentInput) {
        console.log('Not logged in or note input not found, cannot save.');
        return;
    }

    // If currentNoteId is null (e.g., initial state before any note is loaded),
    // then the POST /notes endpoint will create a new one and set it as active.
    // If currentNoteId is set, the backend should implicitly update it since it's the active one.
    try {
        const response = await fetch('/notes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'credentials': 'include'
            },
            body: JSON.stringify({ content: noteContentInput.value })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
            throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorData.message}`);
        }
        console.log('Note content saved successfully!');
    } catch (error) {
        console.error('Error saving note:', error);
    }
}

/**
 * Creates a new empty note and sets it as the active note.
 */
async function createNewNote() {
    if (!currentUser) {
        alert('Please log in to create new notes.');
        return;
    }

    try {
        const response = await fetch('/notes/new', {
            method: 'POST',
            headers: { 'credentials': 'include' }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
            throw new Error(`Failed to create new note: ${response.status} - ${errorData.message}`);
        }

        console.log('New note created and set as active.');
        // After creating a new note, clear the input and load the new active note (which is empty)
        noteContentInput.value = '';
        noteContentInput.focus();
        await loadCurrentNote(); // This will fetch the newly active empty note.
    } catch (error) {
        console.error('Error creating new note:', error);
        alert('Error creating new note. Please try again.');
    }
}

// --- Authentication Functions ---

async function handleLogin() {
    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'credentials': 'include' },
            body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }),
        });
        const result = await res.json();
        if (!res.ok) {
            alert(result.error || 'Login failed');
            return;
        }
        currentUser = result.user;
        await loadCurrentNote(); // Load the active/specified note after login
        toggleUI(true);
    } catch (err) {
        console.error('Login request failed:', err);
        alert('Login request failed');
    }
}

async function handleSignup() {
    try {
        const res = await fetch('/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'credentials': 'include' },
            body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }),
        });
        const result = await res.json();
        if (!res.ok) {
            alert(result.error || 'Signup failed');
            return;
        }
        alert(result.message || 'Check your inbox to confirm your email.');
    } catch (err) {
        console.error('Signup request failed:', err);
        alert('Signup request failed');
    }
}

async function handleLogout() {
    try {
        await fetch('/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
        console.error('Logout request failed:', err);
    } finally {
        currentUser = null;
        currentNoteId = null;
        noteContentInput.value = ''; // Clear the current note input
        toggleUI(false);
        // Clean the URL if logging out from a specific note page
        if (window.location.search.includes('id=')) {
            window.history.replaceState({}, document.title, '/');
        }
    }
}

// --- Initialization and Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
    // Check current user session status
    try {
        const res = await fetch('/currentUser', { credentials: 'include' });
        if (res.ok) {
            const userData = await res.json();
            currentUser = userData.user;
            toggleUI(true);
            await loadCurrentNote(); // Load note based on session/URL
        } else {
            toggleUI(false);
        }
    } catch (err) {
        console.error("Error checking user session:", err);
        toggleUI(false);
    }

    // Attach event listeners
    loginBtn?.addEventListener('click', handleLogin);
    signupBtn?.addEventListener('click', handleSignup);
    logoutBtn?.addEventListener('click', handleLogout);

    // Debounce the note saving on input
    let saveTimer;
    noteContentInput?.addEventListener('input', () => {
        if (currentUser) { // Only attempt to save if logged in
            clearTimeout(saveTimer);
            saveTimer = setTimeout(saveNote, 1000); // Save 1 second after typing stops
        }
    });

    createNewNoteBtn?.addEventListener('click', createNewNote);
    viewAllNotesBtn?.addEventListener('click', () => {
        // Redirect to the /documents page to view all notes
        window.location.href = '/documents';
    });
});
