// public/documentsScript.js

document.addEventListener('DOMContentLoaded', () => {
    const notesList = document.getElementById('notesList'); // Renamed from notesListContainer for clarity
    const backToMainBtn = document.getElementById('backToMainBtn');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const selectAllCheck = document.getElementById('selectAllCheck');

    let allNoteCheckboxes = []; // To store references to all individual note checkboxes

    // --- Helper Functions ---

    /**
     * Updates the disabled state of the delete button based on checked checkboxes.
     */
    function updateDeleteButtonState() {
        const checkedBoxes = Array.from(notesList.querySelectorAll('.note-checkbox:checked'));
        if (deleteSelectedBtn) {
            deleteSelectedBtn.disabled = checkedBoxes.length === 0;
        }

        // Also update the "Select All" checkbox state
        if (selectAllCheck) {
            selectAllCheck.checked = checkedBoxes.length > 0 && checkedBoxes.length === allNoteCheckboxes.length;
            selectAllCheck.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < allNoteCheckboxes.length;
        }
    }

    /**
     * Initializes event listeners for all individual note checkboxes and the "Select All" checkbox.
     * This function should be called after notes are rendered in the DOM.
     */
    function initializeCheckboxes() {
        allNoteCheckboxes = Array.from(notesList.querySelectorAll('.note-checkbox'));

        allNoteCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateDeleteButtonState);
        });

        if (selectAllCheck) {
            selectAllCheck.addEventListener('change', () => {
                const isChecked = selectAllCheck.checked;
                allNoteCheckboxes.forEach(checkbox => {
                    checkbox.checked = isChecked;
                });
                updateDeleteButtonState(); // Update button state after checking/unchecking all
            });
        }

        // Initial state update when the page loads
        updateDeleteButtonState();
    }

    // --- Event Listeners ---

    // Event listener for "Back to Main Note" button
    if (backToMainBtn) {
        backToMainBtn.addEventListener('click', () => {
            window.location.href = '/'; // Redirect to the main note editing page
        });
    }

    // Event listener for "Delete Selected" button
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', async () => {
            const checkedBoxes = Array.from(notesList.querySelectorAll('.note-checkbox:checked'));
            const noteIdsToDelete = checkedBoxes.map(checkbox => checkbox.dataset.noteId);

            if (noteIdsToDelete.length === 0) {
                alert('Please select at least one note to delete.');
                return;
            }

            if (!confirm(`Are you sure you want to delete ${noteIdsToDelete.length} selected note(s)? This action cannot be undone.`)) {
                return; // User cancelled
            }

            try {
                const response = await fetch('/notes', {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'credentials': 'include'
                    },
                    body: JSON.stringify({ noteIds: noteIdsToDelete })
                });

                if (response.ok) {
                    const result = await response.json();
                    alert(result.message || 'Notes deleted successfully!');
                    // Remove deleted notes from the DOM
                    noteIdsToDelete.forEach(id => {
                        const noteItem = notesList.querySelector(`.note-item[data-note-id="${id}"]`);
                        if (noteItem) {
                            noteItem.remove();
                        }
                    });
                    // Re-initialize checkboxes and update button state
                    initializeCheckboxes(); // Re-scan for remaining checkboxes and update state
                } else {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error during deletion.' }));
                    alert(`Failed to delete notes: ${errorData.error}`);
                    console.error('Deletion failed:', errorData);
                }
            } catch (error) {
                console.error('Network error during note deletion:', error);
                alert('Network error deleting notes. Please try again.');
            }
        });
    }

    // Initialize checkboxes and button state once the DOM is fully loaded and notes are present
    initializeCheckboxes();
});
