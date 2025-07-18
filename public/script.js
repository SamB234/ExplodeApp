// public/script.js

// Using the correct import path for supabaseClient.js from public directory
import { supabase } from '/public/supabaseClient.js';

// --- DOM Elements ---
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const logoutBtn = document.getElementById('logoutBtn');

// New: Title Input Element
const noteTitleInput = document.getElementById('noteTitle'); // The new note title input field
const noteContentInput = document.getElementById('noteContent'); // The main note textarea

const authSection = document.getElementById('authSection');
const notesSection = document.getElementById('notesSection');

const createNewNoteBtn = document.getElementById('createNewNoteBtn');
const viewAllNotesBtn = document.getElementById('viewAllNotesBtn');

// --- New Widget DOM Elements ---
const toggleGuidelinesWidgetBtn = document.getElementById('toggleGuidelinesWidgetBtn');
const designGuidelinesWidget = document.getElementById('designGuidelinesWidget');
const nominalWallThicknessInput = document.getElementById('nominalWallThickness');
const thicknessUnitSelect = document.getElementById('thicknessUnit');
const productionProcessSelect = document.getElementById('productionProcess');
const calculateGuidelinesBtn = document.getElementById('calculateGuidelinesBtn');
const guidelinesResults = document.getElementById('guidelinesResults');
const closeGuidelinesWidgetBtn = document.getElementById('closeGuidelinesWidgetBtn');


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
 * Toggles the visibility of authentication, notes sections, and the widget toggle button.
 * @param {boolean} loggedIn True if a user is logged in, false otherwise.
 */
function toggleUI(loggedIn) {
    if (authSection && notesSection && toggleGuidelinesWidgetBtn) {
        if (loggedIn) {
            authSection.classList.add('hidden');
            notesSection.classList.remove('hidden');
            toggleGuidelinesWidgetBtn.classList.remove('hidden'); // Show widget toggle button
        } else {
            authSection.classList.remove('hidden');
            notesSection.classList.add('hidden');
            toggleGuidelinesWidgetBtn.classList.add('hidden'); // Hide widget toggle button
            designGuidelinesWidget.classList.add('hidden'); // Ensure widget is hidden on logout
        }
    } else {
        console.warn("UI sections not found. Check your HTML IDs (authSection, notesSection, toggleGuidelinesWidgetBtn).");
    }
}

/**
 * Converts a value between millimeters and inches.
 * @param {number} value The value to convert.
 * @param {string} fromUnit The unit of the input value ('mm' or 'inch').
 * @param {string} toUnit The desired output unit ('mm' or 'inch').
 * @returns {number} The converted value.
 */
function convertUnits(value, fromUnit, toUnit) {
    const mmPerInch = 25.4;
    if (fromUnit === toUnit) {
        return value;
    }
    if (fromUnit === 'mm' && toUnit === 'inch') {
        return value / mmPerInch;
    }
    if (fromUnit === 'inch' && toUnit === 'mm') {
        return value * mmPerInch;
    }
    return value; // Should not happen
}

/**
 * Rounds a number to a specified number of decimal places.
 * @param {number} value The number to round.
 * @param {number} decimals The number of decimal places.
 * @returns {number} The rounded number.
 */
function roundTo(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}


// --- API Interaction Functions ---

/**
 * Loads the current note content and title into the respective input fields.
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
            const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
            console.error(`Failed to load note from ${url}: ${response.status} - ${errorData.message}`);
            
            // Clear inputs and set placeholders
            noteTitleInput.value = 'Error Loading Note';
            noteContentInput.value = 'Please try creating a new note or refresh.';
            currentNoteId = null; // No note loaded
            
            // If it was a specific ID that failed, redirect to clean URL
            if (noteIdFromUrl) {
                window.history.replaceState({}, document.title, '/');
                alert(`Note with ID ${noteIdFromUrl} not found or inaccessible. Loading default note.`);
                await loadCurrentNote(); // Recursively call to load the actual active note after cleaning URL
            }
            return;
        }

        const note = await response.json();
        noteTitleInput.value = note.title || ''; // Populate title input
        noteContentInput.value = note.content || ''; // Populate content textarea
        currentNoteId = note.id; // Store the ID of the note that was successfully loaded
        console.log(`Note (ID: ${currentNoteId}) loaded successfully. Title: "${note.title}"`);
    } catch (error) {
        console.error('Network error loading note:', error);
        noteTitleInput.value = 'Error Loading Note';
        noteContentInput.value = 'Error loading note. Please check your connection.';
        currentNoteId = null;
    }
}

/**
 * Saves the content and title of the input fields to the current active note on the backend.
 */
async function saveNote() {
    if (!currentUser || !noteContentInput || !noteTitleInput) {
        console.log('Not logged in or note inputs not found, cannot save.');
        return;
    }

    const title = noteTitleInput.value;
    const content = noteContentInput.value;

    // Optional: Prevent saving if both title and content are empty
    if (title.trim() === '' && content.trim() === '') {
        console.log('Note is empty (title and content). Not saving.');
        // Optionally alert the user here
        // alert("Cannot save an empty note. Please add some content or a title.");
        return;
    }

    try {
        const response = await fetch('/notes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'credentials': 'include'
            },
            body: JSON.stringify({ content: content, title: title }) // Send both content AND title
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
            throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorData.message}`);
        }
        
        const result = await response.json();
        console.log('Note saved successfully!', result);
        // If a new note was created (first save for a new session/no active note), update currentNoteId
        if (result.noteId && result.noteId !== currentNoteId) {
            currentNoteId = result.noteId;
            // Optionally update the URL to reflect the new note's ID if desired,
            // but for a text editor that autosaves, keeping the URL clean might be preferred.
            // window.history.replaceState({}, document.title, `/?id=${currentNoteId}`);
        }
    } catch (error) {
        console.error('Error saving note:', error);
        alert('Error saving note. Please try again.'); // User feedback for save failures
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

        const newNoteData = await response.json(); // Get the new note's data from the response
        currentNoteId = newNoteData.note.id; // Set the new note as current

        // Clear the note editor and set a default title
        noteTitleInput.value = newNoteData.note.title || 'New Note';
        noteContentInput.value = newNoteData.note.content || '';
        noteTitleInput.focus(); // Focus on the title for immediate typing
        console.log('New note created and set as active:', newNoteData.note.id);
        alert('New note created!');

        // Update the URL to reflect the new note's ID
        window.history.replaceState({}, document.title, `/?id=${currentNoteId}`);

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
        toggleUI(true);
        await loadCurrentNote(); // Load the active/specified note after login
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
        noteTitleInput.value = ''; // Clear title input
        noteContentInput.value = ''; // Clear content input
        toggleUI(false);
        // Clean the URL if logging out from a specific note page
        if (window.location.search.includes('id=')) {
            window.history.replaceState({}, document.title, '/');
        }
    }
}

// --- Manufacturing Guidelines Widget Logic ---

const designGuidelines = {
    "injection_molding": {
        label: "Injection Molding",
        features: {
            "ribs": {
                label: "Ribs",
                description: "Features used for stiffness or alignment.",
                guidelines: [
                    { name: "Thickness (at base)", type: "ratio", min: 0.4, max: 0.6, unit: "T" },
                    { name: "Max Height", type: "ratio", value: 3, unit: "T" },
                    { name: "Min Spacing", type: "ratio", value: 2, unit: "T" },
                    { name: "Draft Angle (per side)", type: "fixed", value: 0.5, unit: "degrees" },
                    { name: "Base Fillet Radius", type: "ratio", min: 0.25, max: 0.5, unit: "T" }
                ]
            },
            "bosses": {
                label: "Bosses",
                description: "Cylindrical features for fasteners or alignment.",
                guidelines: [
                    { name: "Wall Thickness", type: "ratio", min: 0.4, max: 0.6, unit: "T" },
                    { name: "Base Fillet Radius", type: "ratio", min: 0.25, max: 0.5, unit: "T" },
                    { name: "Max Height (relative to OD)", type: "ratio_of_od", value: 3, unit: "OD" }, // OD of the boss
                    { name: "Draft Angle (OD, per side)", type: "fixed", value: 0.5, unit: "degrees" },
                    { name: "Draft Angle (ID, per side)", type: "fixed", value: 0.25, unit: "degrees" }
                ]
            },
            "corners": {
                label: "Corners",
                description: "Internal and external radii to reduce stress.",
                guidelines: [
                    { name: "Internal Corner Radius", type: "ratio", min: 0.5, max: 0.75, unit: "T" },
                    { name: "External Corner Radius", type: "ratio", min: 1.0, max: 1.25, unit: "T" }
                ]
            },
            "general_draft": {
                label: "General Draft",
                description: "Minimum angle for walls to aid part ejection.",
                guidelines: [
                    { name: "Recommended Draft Angle", type: "fixed", value: 1, unit: "degrees (per side)" }
                ]
            }
        }
    },
    "rotational_molding": {
        label: "Rotational Molding",
        features: {
            "ribs_and_projections": {
                label: "Ribs & Projections",
                description: "Thicker and wider than injection molding ribs.",
                guidelines: [
                    { name: "Thickness (at base)", type: "ratio", value: 1, unit: "T" }, // Often same as wall thickness
                    { name: "Min Width (at base)", type: "ratio", value: 1, unit: "T" }, // For thicker features
                    { name: "Max Height", type: "ratio", value: 4, unit: "T" },
                    { name: "Min Radius at Base", type: "ratio", value: 0.5, unit: "T" },
                    { name: "Draft Angle (per side)", type: "fixed", value: 1.0, unit: "degrees" }
                ]
            },
            "corners": {
                label: "Corners",
                description: "Generous radii are critical for material flow and even wall thickness.",
                guidelines: [
                    { name: "Internal Corner Radius", type: "ratio", min: 0.5, max: 1.0, unit: "T" },
                    { name: "External Corner Radius", type: "ratio", min: 1.5, max: 2.0, unit: "T" }
                ]
            },
            "general_considerations": {
                label: "General Considerations",
                description: "Broad recommendations for roto-molded parts.",
                guidelines: [
                    { name: "Min Wall Thickness", type: "fixed", value: 3.0, unit: "mm (recommended minimum)" },
                    { name: "Max Wall Thickness Variation", type: "fixed", value: 20, unit: "% (over entire part)" },
                    { name: "Min Draft Angle (per side)", type: "fixed", value: 0.5, unit: "degrees" },
                    { name: "Avoid Sharp Features", type: "text", value: "Generous radii and large transitions are key." }
                ]
            }
        }
    }
    // Add more processes as needed
};

function calculateGuidelines() {
    const nominalT = parseFloat(nominalWallThicknessInput.value);
    const unit = thicknessUnitSelect.value;
    const process = productionProcessSelect.value;
    const guidelines = designGuidelines[process];

    if (isNaN(nominalT) || nominalT <= 0) {
        guidelinesResults.innerHTML = '<p class="error-message">Please enter a valid nominal wall thickness.</p>';
        return;
    }
    if (!guidelines) {
        guidelinesResults.innerHTML = '<p class="error-message">Guidelines for this production process are not available.</p>';
        return;
    }

    let html = `<h3>Recommendations for ${guidelines.label} (Nominal T = ${nominalT} ${unit})</h3>`;

    for (const featureKey in guidelines.features) {
        const feature = guidelines.features[featureKey];
        html += `<div class="guideline-feature"><h4>${feature.label}</h4><p class="feature-description">${feature.description}</p><ul>`;

        feature.guidelines.forEach(guide => {
            let calculatedValue = '';
            let valueDisplay = '';

            switch (guide.type) {
                case "ratio":
                    let minVal = roundTo(nominalT * guide.min, 2);
                    let maxVal = roundTo(nominalT * guide.max, 2);
                    if (unit === 'inch') { // Convert to inches for display if original unit was mm
                         minVal = roundTo(convertUnits(minVal, 'mm', 'inch'), 3);
                         maxVal = roundTo(convertUnits(maxVal, 'mm', 'inch'), 3);
                    }
                    calculatedValue = `${minVal} - ${maxVal}`;
                    valueDisplay = `${guide.min}${guide.unit} - ${guide.max}${guide.unit}`;
                    break;
                case "value_or_ratio": // For cases like injection molding where boss wall thickness is 0.6T or fixed 1.5mm
                    const calcValue = nominalT * guide.value_ratio;
                    calculatedValue = roundTo(calcValue, 2);
                    if (unit === 'inch') {
                        calculatedValue = roundTo(convertUnits(calculatedValue, 'mm', 'inch'), 3);
                    }
                    // This case needs refinement based on specific rules, e.g., max(calcValue, fixed_min_value)
                    valueDisplay = `${guide.value_ratio}${guide.unit}`;
                    break;
                case "ratio_of_od": // Specific for Bosses max height
                    // For bosses, we need an assumed outer diameter, let's use 2x nominal wall thickness as a typical base
                    // or ideally, the user should provide it. For now, we'll indicate "relative to OD".
                    const assumedBossOD = nominalT * 2; // Example assumption
                    calculatedValue = roundTo(assumedBossOD * guide.value, 2);
                    if (unit === 'inch') {
                        calculatedValue = roundTo(convertUnits(calculatedValue, 'mm', 'inch'), 3);
                    }
                    valueDisplay = `${guide.value}${guide.unit} (relative to boss OD)`;
                    break;
                case "fixed":
                    let fixedVal = guide.value;
                     if (unit === 'inch' && guide.unit === 'mm') { // If display unit is inch, but guide is fixed mm
                        fixedVal = roundTo(convertUnits(fixedVal, 'mm', 'inch'), 3);
                     } else if (unit === 'mm' && guide.unit === 'inch') { // If display unit is mm, but guide is fixed inch
                        fixedVal = roundTo(convertUnits(fixedVal, 'inch', 'mm'), 3);
                     }
                    calculatedValue = fixedVal;
                    valueDisplay = `${guide.value} ${guide.unit}`; // Show original for reference
                    break;
                case "text":
                    calculatedValue = guide.value;
                    valueDisplay = ""; // No ratio/fixed value to display here
                    break;
                default:
                    calculatedValue = 'N/A';
                    valueDisplay = '';
            }

            if (guide.type === "text") {
                html += `<li><strong>${guide.name}:</strong> ${calculatedValue}</li>`;
            } else if (guide.type === "ratio_of_od") {
                 html += `<li><strong>${guide.name}:</strong> ${calculatedValue} ${unit} (typically max) ${valueDisplay}</li>`;
            }
            else {
                html += `<li><strong>${guide.name}:</strong> ${calculatedValue} ${unit} (recommended) <em>(${valueDisplay})</em></li>`;
            }
        });
        html += `</ul></div>`;
    }

    guidelinesResults.innerHTML = html;
}

// --- Initialization and Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
    // Check current user session status
    try {
        const res = await fetch('/currentUser', { credentials: 'include' });
        if (res.ok) {
            const userData = await res.json();
            currentUser = userData.user;
            toggleUI(true); // This now also shows the widget toggle button
            await loadCurrentNote(); // Load note based on session/URL
        } else {
            toggleUI(false);
        }
    } catch (err) {
        console.error("Error checking user session:", err);
        toggleUI(false);
    }

    // Attach authentication and note event listeners
    loginBtn?.addEventListener('click', handleLogin);
    signupBtn?.addEventListener('click', handleSignup);
    logoutBtn?.addEventListener('click', handleLogout);

    // Debounce the note saving on input for both title and content
    let saveTimer;
    const saveHandler = () => {
        if (currentUser) { // Only attempt to save if logged in
            clearTimeout(saveTimer);
            saveTimer = setTimeout(saveNote, 1000); // Save 1 second after typing stops
        }
    };

    noteContentInput?.addEventListener('input', saveHandler);
    noteTitleInput?.addEventListener('input', saveHandler);

    createNewNoteBtn?.addEventListener('click', createNewNote);
    viewAllNotesBtn?.addEventListener('click', () => {
        // Redirect to the /documents page to view all notes
        window.location.href = '/documents';
    });

    // --- New Widget Event Listeners ---
    toggleGuidelinesWidgetBtn?.addEventListener('click', () => {
        designGuidelinesWidget.classList.toggle('hidden');
        // Hide the notes section if the widget is shown, for better focus
        if (!designGuidelinesWidget.classList.contains('hidden')) {
            notesSection.classList.add('hidden');
            toggleGuidelinesWidgetBtn.textContent = 'Close Design Guidelines';
        } else {
            notesSection.classList.remove('hidden'); // Show notes when widget closes
            toggleGuidelinesWidgetBtn.textContent = 'Open Design Guidelines';
        }
    });

    closeGuidelinesWidgetBtn?.addEventListener('click', () => {
        designGuidelinesWidget.classList.add('hidden');
        notesSection.classList.remove('hidden'); // Show notes again
        toggleGuidelinesWidgetBtn.textContent = 'Open Design Guidelines';
    });

    calculateGuidelinesBtn?.addEventListener('click', calculateGuidelines);

    // Optional: Recalculate on Enter key in thickness input
    nominalWallThicknessInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            calculateGuidelines();
        }
    });
    // Optional: Recalculate when unit or process changes
    thicknessUnitSelect?.addEventListener('change', calculateGuidelines);
    productionProcessSelect?.addEventListener('change', calculateGuidelines);

});
