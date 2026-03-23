const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public')); // Aquí irá tu HTML

app.post('/buscar', (req, res) => {
    const { carpeta, texto } = req.body;
    
    // Comando para Windows (findstr)
    // /S: subcarpetas, /I: ignore case, /M: solo nombre de archivo
    const comando = `findstr /S /I /M /C:"${texto}" "${carpeta}\\*.*"`;

    exec(comando, (error, stdout, stderr) => {
        if (error && stdout === "") {
            return res.json({ resultados: [] });
        }
        const lista = stdout.split('\r\n').filter(line => line.trim() !== "");
        res.json({ resultados: lista });
    });
});

app.listen(port, () => {
    console.log(`Servidor de búsqueda corriendo en http://localhost:${port}`);
});