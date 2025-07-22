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
            "general": {
                label: "General Guidelines",
                description: "Basic considerations for robust injection molded parts.",
                guidelines: [
                    { name: "Nominal Wall Thickness", type: "range_fixed", min_mm: 1.0, max_mm: 5.0, preferred_mm: 2.5, unit: "mm" },
                    { name: "Draft Angle (per side)", type: "fixed_value", value: 1, unit: "degrees" },
                    { name: "Corner Radii (internal)", type: "ratio_range", min: 0.5, max: 0.75, unit: "T" },
                    { name: "Corner Radii (external)", type: "ratio_range", min: 1.0, max: 1.25, unit: "T" },
                    { name: "Ejector Pin Marks", type: "text", value: "Allow space for ejector pin marks on non-cosmetic surfaces." },
                    { name: "Gate Locations", type: "text", value: "Consider gate locations for aesthetic impact and flow." }
                ]
            },
            "ribs": {
                label: "Ribs",
                description: "Used for stiffness, alignment, and reducing sink marks.",
                guidelines: [
                    { name: "Thickness (at base)", type: "ratio_range", min: 0.4, max: 0.6, unit: "T" },
                    { name: "Max Height", type: "ratio_single_value", value: 3, unit: "T" },
                    { name: "Min Spacing", type: "ratio_single_value", value: 2, unit: "T" },
                    { name: "Draft Angle (per side)", type: "fixed_value", value: 0.5, unit: "degrees" },
                    { name: "Base Fillet Radius", type: "ratio_range", min: 0.25, max: 0.5, unit: "T" }
                ]
            },
            "bosses": {
                label: "Bosses",
                description: "Cylindrical features for fasteners, pins, or alignment.",
                guidelines: [
                    { name: "Wall Thickness (relative to OD)", type: "ratio_range", min: 0.4, max: 0.6, unit: "T" },
                    { name: "Base Fillet Radius", type: "ratio_range", min: 0.25, max: 0.5, unit: "T" },
                    { name: "Max Height (relative to Boss OD)", type: "ratio_single_value", value: 3, unit: "OD" }, // OD of the boss
                    { name: "Draft Angle (OD, per side)", type: "fixed_value", value: 0.5, unit: "degrees" },
                    { name: "Draft Angle (ID, per side)", type: "fixed_value", value: 0.25, unit: "degrees" }
                ]
            },
            "holes_and_slots": {
                label: "Holes & Slots",
                description: "Features for assembly or weight reduction.",
                guidelines: [
                    { name: "Min Hole Diameter", type: "ratio_single_value", value: 1, unit: "T" },
                    { name: "Spacing from Wall Edge", type: "ratio_single_value", value: 2, unit: "T" },
                    { name: "Through-Hole Deburring", type: "text", value: "Consider counterbores or countersinks if deburring is critical." }
                ]
            },
            "material_considerations": {
                label: "Material & Shrinkage",
                description: "Impact of material choice on design.",
                guidelines: [
                    { name: "Typical Shrinkage (Amorphous)", type: "range_percentage", min: 0.2, max: 0.7, unit: "%" }, // e.g., PC, PMMA, ABS
                    { name: "Typical Shrinkage (Semi-Crystalline)", type: "range_percentage", min: 1.5, max: 2.5, unit: "%" }, // e.g., PP, PE, Nylon
                    { name: "Glass Fiber Fill", type: "text", value: "Glass fiber increases stiffness but also shrinkage anisotropy." }
                ]
            }
        }
    },
    "rotational_molding": {
        label: "Rotational Molding",
        features: {
            "general": {
                label: "General Guidelines",
                description: "Design for robust, even wall thickness in rotationally molded parts.",
                guidelines: [
                    { name: "Nominal Wall Thickness", type: "range_fixed", min_mm: 3.0, max_mm: 10.0, preferred_mm: 6.0, unit: "mm" },
                    { name: "Min Draft Angle (per side)", type: "fixed_value", value: 0.5, unit: "degrees" },
                    { name: "Internal Corner Radius", type: "ratio_range", min: 0.5, max: 1.0, unit: "T" },
                    { name: "External Corner Radius", type: "ratio_range", min: 1.5, max: 2.0, unit: "T" },
                    { name: "Wall Thickness Variation", type: "fixed_value", value: 20, unit: "% max variation" },
                    { name: "Avoid Sharp Features", type: "text", value: "Generous radii and large transitions are critical for material flow and uniform wall thickness." }
                ]
            },
            "ribs_and_projections": {
                label: "Ribs & Projections",
                description: "Thicker and wider than injection molding ribs due to process.",
                guidelines: [
                    { name: "Thickness (at base)", type: "ratio_single_value", value: 1, unit: "T" }, // Often same as wall thickness
                    { name: "Min Width (at base)", type: "ratio_single_value", value: 1, unit: "T" }, // For thicker features
                    { name: "Max Height", type: "ratio_single_value", value: 4, unit: "T" },
                    { name: "Min Radius at Base", type: "ratio_single_value", value: 0.5, unit: "T" },
                    { name: "Draft Angle (per side)", type: "fixed_value", value: 1.0, unit: "degrees" }
                ]
            },
            "inserts_and_threads": {
                label: "Inserts & Threads",
                description: "Methods for adding features that cannot be molded directly.",
                guidelines: [
                    { name: "Molded-in Inserts", type: "text", value: "Use only for simple geometries. Should have large knurls/features for resin flow." },
                    { name: "Post-mold Inserts", type: "text", value: "Better for high-precision or complex threaded connections (e.g., heat-set, ultrasonic)." },
                    { name: "External Threads", type: "text", value: "Generally molded, requires large pitch and root radii for good definition." },
                    { name: "Internal Threads", type: "text", value: "Not recommended for molding. Consider threaded inserts or self-tapping screws." }
                ]
            }
        }
    },
    "thermoforming": {
        label: "Thermoforming",
        features: {
            "general": {
                label: "General Guidelines",
                description: "Key considerations for vacuum and pressure forming processes.",
                guidelines: [
                    { name: "Starting Sheet Thickness", type: "range_fixed", min_mm: 0.25, max_mm: 12.0, preferred_mm: 3.0, unit: "mm" },
                    { name: "Min Draft Angle (per side)", type: "fixed_value", value: 2, unit: "degrees" },
                    { name: "Ideal Draft Angle", type: "fixed_value", value: 5, unit: "degrees" },
                    { name: "Internal Corner Radius", type: "ratio_range", min: 1.0, max: 2.0, unit: "T" },
                    { name: "External Corner Radius", type: "ratio_range", min: 0.5, max: 1.0, unit: "T" },
                    { name: "Depth of Draw Ratio", type: "fixed_value", value: 1.5, unit: ":1 (typically)" }, // Depth to smallest width
                    { name: "Webbing", type: "text", value: "Avoid sharp angles and deep, narrow channels to prevent material bridging." }
                ]
            },
            "undercuts": {
                label: "Undercuts & Features",
                description: "Handling features not directly moldable.",
                guidelines: [
                    { name: "Eliminate Undercuts", type: "text", value: "Design parts to avoid undercuts where possible, or use split molds." },
                    { name: "Holes and Cutouts", type: "text", value: "Often pierced or trimmed in a secondary operation after forming." },
                    { name: "Texture", type: "text", value: "Texture can hide surface imperfections and improve aesthetics; requires more draft." }
                ]
            },
            "material_considerations": {
                label: "Material Selection",
                description: "Common thermoforming materials and their properties.",
                guidelines: [
                    { name: "Common Materials", type: "text", value: "ABS, HIPS, PVC, PETG, HDPE, PP, PC." },
                    { name: "Material Stretchability", type: "text", value: "Materials vary in ability to stretch uniformly, affecting deep draws." }
                ]
            }
        }
    }
};

function calculateGuidelines() {
    const nominalT = parseFloat(nominalWallThicknessInput.value);
    const unit = thicknessUnitSelect.value;
    const process = productionProcessSelect.value;
    const guidelines = designGuidelines[process];

    if (isNaN(nominalT) || nominalT <= 0) {
        guidelinesResults.innerHTML = '<p class="error-message">Please enter a valid nominal wall thickness (e.g., 3).</p>';
        return;
    }
    if (!guidelines) {
        guidelinesResults.innerHTML = '<p class="error-message">Guidelines for this production process are not available.</p>';
        return;
    }

    let html = `<h3>Recommendations for ${guidelines.label} (Nominal T = ${nominalT} ${unit})</h3>`;
    html += '<p class="intro-text">These guidelines provide general recommendations. Specific material properties and part geometry may require deviations. Always consult with your manufacturer.</p>';


    for (const featureKey in guidelines.features) {
        const feature = guidelines.features[featureKey];
        html += `<div class="guideline-feature"><h4>${feature.label}</h4><p class="feature-description">${feature.description}</p><ul>`;

        feature.guidelines.forEach(guide => {
            let calculatedValueHtml = '';
            let unitToDisplay = unit; // Default unit for calculated dimensions

            if (guide.type === "ratio_range") {
                let minVal = roundTo(nominalT * guide.min, 2);
                let maxVal = roundTo(nominalT * guide.max, 2);
                if (unit === 'inch') {
                     minVal = roundTo(convertUnits(minVal, 'mm', 'inch'), 3);
                     maxVal = roundTo(convertUnits(maxVal, 'mm', 'inch'), 3);
                }
                calculatedValueHtml = `${minVal} - ${maxVal} ${unitToDisplay} <em>(${guide.min}${guide.unit} - ${guide.max}${guide.unit})</em>`;
            } else if (guide.type === "ratio_single_value") {
                let val = roundTo(nominalT * guide.value, 2);
                if (unit === 'inch') {
                    val = roundTo(convertUnits(val, 'mm', 'inch'), 3);
                }
                // Special handling for "Max Height (relative to Boss OD)"
                if (guide.unit === "OD") {
                     // Assume Boss OD is 2x Nominal T for calculation example, but state it's relative to OD
                     let assumedBossOD = nominalT * 2;
                     let calculatedODHeight = roundTo(assumedBossOD * guide.value, 2);
                     if (unit === 'inch') {
                         calculatedODHeight = roundTo(convertUnits(calculatedODHeight, 'mm', 'inch'), 3);
                     }
                     calculatedValueHtml = `${calculatedODHeight} ${unitToDisplay} (relative to approx. ${roundTo(assumedBossOD,2)}${unitToDisplay} Boss OD) <em>(${guide.value}${guide.unit})</em>`;
                } else {
                     calculatedValueHtml = `${val} ${unitToDisplay} <em>(${guide.value}${guide.unit})</em>`;
                }
            } else if (guide.type === "fixed_value") {
                // If the guide unit is 'degrees', display as degrees, no conversion needed
                if (guide.unit.includes('degrees') || guide.unit.includes('%')) {
                    calculatedValueHtml = `${guide.value} ${guide.unit}`;
                } else { // It's a dimension, convert if units differ
                    let displayVal = guide.value;
                    let originalUnit = guide.unit; // e.g., 'mm' or 'inch' from the data structure

                    if (unit !== originalUnit) {
                        displayVal = convertUnits(displayVal, originalUnit, unit);
                    }
                    calculatedValueHtml = `${roundTo(displayVal, unit === 'mm' ? 2 : 3)} ${unit} <em>(${guide.value} ${originalUnit} recommended)</em>`;
                }
            } else if (guide.type === "text") {
                calculatedValueHtml = `${guide.value}`;
            } else if (guide.type === "range_fixed") { // For fixed ranges like nominal wall thickness
                let minVal = guide.min_mm;
                let maxVal = guide.max_mm;
                let preferredVal = guide.preferred_mm;

                if (unit === 'inch') {
                    minVal = convertUnits(minVal, 'mm', 'inch');
                    maxVal = convertUnits(maxVal, 'mm', 'inch');
                    preferredVal = convertUnits(preferredVal, 'mm', 'inch');
                }
                calculatedValueHtml = `${roundTo(minVal, unit === 'mm' ? 2 : 3)} - ${roundTo(maxVal, unit === 'mm' ? 2 : 3)} ${unit} (Preferred: ${roundTo(preferredVal, unit === 'mm' ? 2 : 3)} ${unit})`;
            } else if (guide.type === "range_percentage") {
                 calculatedValueHtml = `${guide.min}% - ${guide.max}% ${guide.unit}`;
            }
            else {
                calculatedValueHtml = 'N/A';
            }

            html += `<li><strong>${guide.name}:</strong> ${calculatedValueHtml}</li>`;
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

    // Set initial values and calculate on load for a good default view
    nominalWallThicknessInput.value = 3; // Default to 3mm
    thicknessUnitSelect.value = 'mm';
    productionProcessSelect.value = 'injection_molding';
    calculateGuidelines(); // Calculate initial guidelines on load


//TEST SECTION

// Guest login button
const guestBtn = document.getElementById('guestBtn');

guestBtn?.addEventListener('click', () => {
  currentUser = { id: 'guest', email: 'guest@demo.com' }; // Fake guest object
  notes.value = localStorage.getItem('guest_notes') || ''; // Load guest notes from localStorage
  toggleUI(true);
});

// If guest user types, save to localStorage instead of backend
notes?.addEventListener('input', async () => {
  if (!currentUser) return;

  if (currentUser.id === 'guest') {
    localStorage.setItem('guest_notes', notes.value);
    return;
  }

  // Authenticated user – save to backend
  try {
    await fetch('/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: notes.value }),
    });
  } catch (err) {
    console.error('Failed to save notes', err);
  }

//TEST SECTION
    
});
