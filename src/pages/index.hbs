<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>{{title}}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 40px;
      background: #f9f9f9;
    }

    h1 {
      font-size: 1.6em;
      margin-bottom: 20px;
    }

    .container {
      display: flex;
      gap: 40px;
      flex-wrap: wrap;
    }

    .notes-section, .canvas-section {
      flex: 1;
      min-width: 300px;
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
    }

    textarea {
      width: 100%;
      height: 300px;
      font-size: 1em;
      font-family: monospace;
      padding: 10px;
      border: 1px solid #ccc;
      border-radius: 6px;
    }

    canvas {
      border: 1px solid #ccc;
      border-radius: 6px;
      background: #fff;
    }

    .tools {
      margin-top: 10px;
      display: flex;
      gap: 10px;
    }

    button {
      font-size: 1em;
      padding: 6px 12px;
      cursor: pointer;
    }

    /* Optional: Style commented out exploded view form */
    /*
    #explodeForm {
      margin-top: 40px;
    }
    */
  </style>
</head>
<body>
  <h1>{{title}}</h1>

  <div class="container">
    <!-- ✍️ Notes Section -->
    <div class="notes-section">
      <h2>Engineering Notes</h2>
      <textarea id="notes" placeholder="Type your notes here..."></textarea>
      <p style="font-size: 0.9em; color: gray;">Autosaves to your browser</p>
    </div>

    <!-- 🖊 Drawing Pad -->
    <div class="canvas-section">
      <h2>Sketch Pad</h2>
      <canvas id="drawingCanvas" width="400" height="300"></canvas>
      <div class="tools">
        <button id="clearBtn">Clear</button>
        <button id="downloadBtn">Download</button>
      </div>
    </div>
  </div>

  <!-- 🔧 Exploded View App (commented out) -->
  <!--
  <form id="explodeForm">
    <label for="explodeLevel">Explode Level (0-100):</label>
    <input type="range" id="explodeLevel" name="explodeLevel" min="0" max="100" value="0" />
    <span id="explodeValue">0</span>
    <br />
    <button type="submit">Explode Assembly</button>
  </form>
  -->

  <script>
    // ✍️ Notes autosave to localStorage
    const notes = document.getElementById('notes');
    notes.value = localStorage.getItem('engineeringNotes') || '';
    notes.addEventListener('input', () => {
      localStorage.setItem('engineeringNotes', notes.value);
    });

    // 🖊 Basic Canvas Drawing
    const canvas = document.getElementById('drawingCanvas');
    const ctx = canvas.getContext('2d');
    let drawing = false;

    canvas.addEventListener('mousedown', () => drawing = true);
    canvas.addEventListener('mouseup', () => drawing = false);
    canvas.addEventListener('mouseout', () => drawing = false);
    canvas.addEventListener('mousemove', draw);

    function draw(e) {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000';
      ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    }

    // Clear and download buttons
    document.getElementById('clearBtn').addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
    });

    document.getElementById('downloadBtn').addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = 'sketch.png';
      link.href = canvas.toDataURL();
      link.click();
    });

    // 🛠️ Old explode form (still commented)
    /*
    const explodeSlider = document.getElementById('explodeLevel');
    const explodeValue = document.getElementById('explodeValue');
    explodeSlider.addEventListener('input', () => {
      explodeValue.textContent = explodeSlider.value;
    });

    const form = document.getElementById('explodeForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const level = explodeSlider.value;
      alert(`You would send explode command with level: ${level} here.`);
    });
    */
  </script>
</body>
</html>
