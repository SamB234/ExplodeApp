// public/documentsScript.js

document.addEventListener('DOMContentLoaded', () => {
    const notesListContainer = document.getElementById('notesList');

    if (notesListContainer) {
        // Add a click event listener to the container, using event delegation
        notesListContainer.addEventListener('click', (event) => {
            // Find the closest parent with the class 'note-list-item'
            // This ensures we get the correct note ID even if a child element (like a paragraph) is clicked
            const clickedNoteItem = event.target.closest('.note-list-item');

            if (clickedNoteItem) {
                const noteId = clickedNoteItem.dataset.noteId; // Get the ID from the data-note-id attribute

                if (noteId) {
                    console.log('Clicked note with ID:', noteId);
                    // Redirect to the main editing page ('/') and pass the note ID as a query parameter
                    // The main page's loadNotes function (via GET /notes) will then activate and display this note.
                    window.location.href = `/?id=${noteId}`;
                }
            }
        });
    }
});
