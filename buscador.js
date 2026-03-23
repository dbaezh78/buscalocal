const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const app = express();
const port = 5000;

app.use(express.json());

// --- INTERFAZ HTML (Frontend) ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Buscador de Texto Local</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px; }
                .container { max-width: 900px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                h2 { color: #333; display: flex; align-items: center; gap: 10px; }
                .form-group { margin-bottom: 15px; }
                label { display: block; margin-bottom: 5px; font-weight: bold; color: #555; }
                input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; font-size: 15px; }
                button { width: 100%; padding: 15px; background-color: #28a745; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; }
                button:hover { background-color: #218838; }
                .info { margin-top: 20px; font-weight: bold; color: #666; border-bottom: 2px solid #eee; padding-bottom: 10px; }
                #resultados { margin-top: 15px; }
                .resultado-item { background: #fff; border: 1px solid #eee; padding: 15px; border-left: 5px solid #007bff; margin-bottom: 10px; border-radius: 4px; }
                .ruta { font-size: 12px; color: #007bff; font-weight: bold; margin-bottom: 5px; word-break: break-all; }
                .linea-texto { font-family: 'Consolas', monospace; font-size: 14px; color: #333; display: block; padding: 5px; background: #f8f9fa; }
                .num-linea { color: #dc3545; font-weight: bold; margin-right: 8px; }
                .resaltado { background-color: #fff3cd; padding: 2px; border-radius: 2px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>🔍 Buscador de Contenido</h2>
                <div class="form-group">
                    <label>Ruta de la carpeta:</label>
                    <input type="text" id="ruta" placeholder="C:\\db\\Github\\resucito">
                </div>
                <div class="form-group">
                    <label>Texto a buscar:</label>
                    <input type="text" id="texto" placeholder="Escribe aquí el código o frase...">
                </div>
                <button onclick="buscar()">Iniciar Búsqueda en Subcarpetas</button>
                
                <div id="info" class="info">Esperando búsqueda...</div>
                <div id="resultados"></div>
            </div>

            <script>
                async function buscar() {
                    const ruta = document.getElementById('ruta').value;
                    const texto = document.getElementById('texto').value;
                    const resDiv = document.getElementById('resultados');
                    const info = document.getElementById('info');

                    if(!ruta || !texto) return alert("Completa los campos");

                    info.innerHTML = "⏳ Buscando coincidencias...";
                    resDiv.innerHTML = "";

                    try {
                        const response = await fetch('/search', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ ruta, texto })
                        });
                        const data = await response.json();
                        
                        info.innerHTML = "Archivos con coincidencias: " + data.resultados.length;

                        if(data.resultados.length === 0) {
                            resDiv.innerHTML = "<p>No se encontró nada.</p>";
                            return;
                        }

                        resDiv.innerHTML = data.resultados.map(r => \`
                            <div class="resultado-item">
                                <div class="ruta">📄 \${r.archivo}</div>
                                <code class="linea-texto">
                                    <span class="num-linea">Línea \${r.n_linea}:</span>\${r.contenido}
                                </code>
                            </div>
                        \`).join('');
                    } catch (err) {
                        info.innerHTML = "❌ Error en el servidor";
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// --- LÓGICA DE BÚSQUEDA (Backend) ---
app.post('/search', (req, res) => {
    const { ruta, texto } = req.body;
    
    // Comando findstr: /S (subcarpetas), /I (ignora mayúsculas), /N (número de línea)
    // El /C:"texto" busca la frase exacta incluyendo espacios
    const comando = `findstr /S /I /N /C:"${texto}" "${ruta}\\*.*"`;

    exec(comando, { maxBuffer: 1024 * 5000 }, (error, stdout, stderr) => {
        // Si no hay resultados, findstr suele devolver error 1, manejamos eso:
        if (!stdout) {
            return res.json({ resultados: [] });
        }

        const lineas = stdout.split('\r\n').filter(l => l.trim() !== "");
        
        const resultados = lineas.map(l => {
            // Expresión regular para separar: RUTA (con C:) : LINEA : CONTENIDO
            const match = l.match(/^([a-zA-Z]:[^:]+):(\d+):(.*)$/);
            if (match) {
                return {
                    archivo: match[1],
                    n_linea: match[2],
                    contenido: match[3]
                };
            }
            return null;
        }).filter(Boolean);

        res.json({ resultados });
    });
});

app.listen(port, () => {
    console.log('============================================');
    console.log(`Servidor iniciado en: http://localhost:${port}`);
    console.log('Presiona Ctrl+C para detenerlo');
    console.log('============================================');
});