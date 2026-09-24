const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const { execFile } = require('child_process');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');

const app = express();
const port = 5000;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// Active search tokens for cancellation
const activeSearches = new Set();

// Path to persistent history
const HISTORY_FILE = path.join(__dirname, 'history.json');

// --- HISTORIAL ---
function getHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error al leer historial:', e.message);
    }
    return { recentFolders: [], recentSearches: [] };
}

function saveHistory(historyData) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyData, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar historial:', e.message);
    }
}

function recordFolderSearch(folderPath) {
    if (!folderPath) return;
    const history = getHistory();
    const cleanPath = path.normalize(folderPath.trim());
    history.recentFolders = history.recentFolders.filter(f => f.toLowerCase() !== cleanPath.toLowerCase());
    history.recentFolders.unshift(cleanPath);
    if (history.recentFolders.length > 30) {
        history.recentFolders = history.recentFolders.slice(0, 30);
    }
    saveHistory(history);
}

function recordQuerySearch(query, folderPath, matchesCount, filesCount) {
    if (!query || !query.trim()) return;
    const history = getHistory();
    const cleanQuery = query.trim();
    const cleanPath = folderPath ? path.normalize(folderPath.trim()) : '';
    
    // Add new search record
    const record = {
        id: Date.now().toString(),
        query: cleanQuery,
        folder: cleanPath,
        date: new Date().toLocaleString('es-ES', { 
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        }),
        timestamp: Date.now(),
        matchesCount,
        filesCount
    };
    
    // Filter existing same query to move to top
    history.recentSearches = history.recentSearches.filter(s => !(s.query.toLowerCase() === cleanQuery.toLowerCase() && s.folder.toLowerCase() === cleanPath.toLowerCase()));
    history.recentSearches.unshift(record);
    if (history.recentSearches.length > 50) {
        history.recentSearches = history.recentSearches.slice(0, 50);
    }
    saveHistory(history);
}

// --- NORMALIZACIÓN DE ACENTOS Y EXPRESIÓN REGULAR ---
const ACCENT_MAP = {
    'a': '[aáàäâãAÁÀÄÂÃ]', 'á': '[aáàäâãAÁÀÄÂÃ]', 'à': '[aáàäâãAÁÀÄÂÃ]', 'ä': '[aáàäâãAÁÀÄÂÃ]', 'â': '[aáàäâãAÁÀÄÂÃ]', 'ã': '[aáàäâãAÁÀÄÂÃ]',
    'e': '[eéèëêEÉÈËÊ]', 'é': '[eéèëêEÉÈËÊ]', 'è': '[eéèëêEÉÈËÊ]', 'ë': '[eéèëêEÉÈËÊ]', 'ê': '[eéèëêEÉÈËÊ]',
    'i': '[iíìïîIÍÌÏÎ]', 'í': '[iíìïîIÍÌÏÎ]', 'ì': '[iíìïîIÍÌÏÎ]', 'ï': '[iíìïîIÍÌÏÎ]', 'î': '[iíìïîIÍÌÏÎ]',
    'o': '[oóòöôõOÓÒÖÔÕ]', 'ó': '[oóòöôõOÓÒÖÔÕ]', 'ò': '[oóòöôõOÓÒÖÔÕ]', 'ö': '[oóòöôõOÓÒÖÔÕ]', 'ô': '[oóòöôõOÓÒÖÔÕ]', 'õ': '[oóòöôõOÓÒÖÔÕ]',
    'u': '[uúùüûUÚÙÜÛ]', 'ú': '[uúùüûUÚÙÜÛ]', 'ù': '[uúùüûUÚÙÜÛ]', 'ü': '[uúùüûUÚÙÜÛ]', 'û': '[uúùüûUÚÙÜÛ]',
    'n': '[nñNÑ]', 'ñ': '[nñNÑ]',
    'c': '[cçCÇ]', 'ç': '[cçCÇ]'
};

function buildSearchRegex(query, { ignoreAccents = true, matchCase = false, wholeWord = false } = {}) {
    let pattern = '';
    for (let i = 0; i < query.length; i++) {
        const char = query[i];
        const lower = char.toLowerCase();
        if (ignoreAccents && ACCENT_MAP[lower]) {
            pattern += ACCENT_MAP[lower];
        } else {
            pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
    }
    if (wholeWord) {
        pattern = `(?<=^|\\W)${pattern}(?=\\W|$)`;
    }
    return new RegExp(pattern, matchCase ? 'g' : 'gi');
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function highlightSnippet(line, regex, maxLen = 350) {
    regex.lastIndex = 0;
    let match;
    let firstMatchIndex = -1;

    while ((match = regex.exec(line)) !== null) {
        if (firstMatchIndex === -1) firstMatchIndex = match.index;
        if (regex.lastIndex === match.index) regex.lastIndex++;
    }

    if (firstMatchIndex === -1) return null;

    let startOffset = 0;
    let endOffset = line.length;
    let prefixEllipsis = '';
    let suffixEllipsis = '';

    if (line.length > maxLen) {
        startOffset = Math.max(0, firstMatchIndex - 50);
        endOffset = Math.min(line.length, startOffset + maxLen);
        if (startOffset > 0) prefixEllipsis = '... ';
        if (endOffset < line.length) suffixEllipsis = ' ...';
    }

    const visibleChunk = line.slice(startOffset, endOffset);
    regex.lastIndex = 0;
    let cursor = 0;
    let highlighted = prefixEllipsis;

    while ((match = regex.exec(visibleChunk)) !== null) {
        highlighted += escapeHtml(visibleChunk.slice(cursor, match.index));
        highlighted += `<mark class="resaltado">${escapeHtml(match[0])}</mark>`;
        cursor = match.index + match[0].length;
        if (regex.lastIndex === match.index) regex.lastIndex++;
    }
    highlighted += escapeHtml(visibleChunk.slice(cursor));
    highlighted += suffixEllipsis;

    return highlighted;
}

// --- LECTURA EXHAUSTIVA DE ARCHIVOS ---
async function extractFileText(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    try {
        if (ext === '.docx') {
            const res = await mammoth.extractRawText({ path: filePath });
            return res.value || '';
        }
        if (['.xlsx', '.xls', '.ods'].includes(ext)) {
            const wb = XLSX.readFile(filePath, { cellDates: true });
            let fullText = '';
            for (const name of wb.SheetNames) {
                fullText += `[Hoja: ${name}]\n` + XLSX.utils.sheet_to_txt(wb.Sheets[name]) + '\n';
            }
            return fullText;
        }
        if (ext === '.pdf') {
            const buf = await fsPromises.readFile(filePath);
            const parser = new PDFParse({ data: buf });
            await parser.load();
            const text = await parser.getText();
            await parser.destroy();
            return text || '';
        }

        // Archivos de texto plano / código / configuración / etc.
        const buffer = await fsPromises.readFile(filePath);
        if (buffer.length === 0) return '';

        // Detección de BOM (UTF-16LE / UTF-8)
        if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
            return buffer.toString('utf16le');
        }
        if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
            return buffer.subarray(3).toString('utf8');
        }

        // Heurística de binario (buscar bytes nulos en los primeros 1024 bytes)
        const checkLen = Math.min(buffer.length, 1024);
        let nullCount = 0;
        for (let i = 0; i < checkLen; i++) {
            if (buffer[i] === 0) nullCount++;
        }
        if (nullCount > 2) {
            return null; // Archivo binario (ej: imágenes, zip, dll, exe), se omite
        }

        return buffer.toString('utf8');
    } catch (err) {
        return null;
    }
}

// Extensiones de archivos de texto comunes
const TEXT_EXTENSIONS = new Set([
    '.txt', '.text', '.md', '.markdown', '.json', '.csv', '.tsv', '.xml', '.html', '.htm',
    '.xhtml', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.scss', '.sass',
    '.less', '.php', '.py', '.pyw', '.rb', '.java', '.c', '.cpp', '.h', '.hpp',
    '.cs', '.go', '.rs', '.swift', '.kt', '.sql', '.sh', '.bash', '.bat', '.cmd',
    '.ps1', '.ini', '.cfg', '.conf', '.yaml', '.yml', '.env', '.properties', '.rst',
    '.rtf', '.log', '.svg', '.vue', '.svelte', '.asp', '.aspx', '.jsp', '.r',
    '.lua', '.dart', '.toml', '.vbs', '.asm'
]);

function shouldCheckFile(ext, extensionFilter) {
    if (!extensionFilter || extensionFilter.trim() === '*' || extensionFilter.trim() === '') {
        return true;
    }
    const allowed = extensionFilter
        .split(',')
        .map(e => e.trim().toLowerCase())
        .map(e => e.startsWith('.') ? e : '.' + e);
    return allowed.includes(ext.toLowerCase());
}

// Búsqueda en un archivo
async function searchInFile(filePath, regex, maxFileSizeMB = 30) {
    try {
        const stats = await fsPromises.stat(filePath);
        if (stats.size > maxFileSizeMB * 1024 * 1024) {
            return null; // Demasiado grande
        }

        const text = await extractFileText(filePath);
        if (text === null || typeof text !== 'string') {
            return null;
        }

        regex.lastIndex = 0;
        if (!regex.test(text)) {
            return null;
        }

        const lines = text.split(/\r?\n/);
        const coincidencias = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || line.trim() === '') continue;

            regex.lastIndex = 0;
            if (regex.test(line)) {
                const snippet = highlightSnippet(line, regex);
                if (snippet) {
                    coincidencias.push({
                        n_linea: i + 1,
                        contenido: snippet,
                        textoPuro: line.length > 300 ? line.slice(0, 300) + '...' : line
                    });
                }
            }
        }

        if (coincidencias.length === 0) return null;

        const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'txt';
        return {
            archivo: filePath,
            nombre: path.basename(filePath),
            dir: path.dirname(filePath),
            tipo: ext,
            tamano: stats.size,
            fechaMod: stats.mtime,
            coincidencias
        };
    } catch (err) {
        return null;
    }
}

// Recorrido de carpetas
const IGNORED_FOLDERS = new Set([
    '.git', '.svn', '.hg', 'node_modules', '$recycle.bin',
    'system volume information', '.vscode', '.idea', 'dist', 'build',
    'coverage', '__pycache__', '.next', '.nuxt', 'temp', 'tmp'
]);

async function collectFiles(rootDir, options, isCancelled) {
    const files = [];

    async function walk(currentDir) {
        if (isCancelled()) return;
        let entries;
        try {
            entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
        } catch (e) {
            return;
        }

        for (const entry of entries) {
            if (isCancelled()) return;
            const fullPath = path.join(currentDir, entry.name);
            const lowerName = entry.name.toLowerCase();

            if (entry.isDirectory()) {
                if (options.ignorarSistema && IGNORED_FOLDERS.has(lowerName)) {
                    continue;
                }
                if (options.subcarpetas) {
                    await walk(fullPath);
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (shouldCheckFile(ext, options.extensiones)) {
                    files.push(fullPath);
                }
            }
        }
    }

    await walk(rootDir);
    return files;
}

// --- RUTAS DEL SERVIDOR ---

// Página de inicio
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint de búsqueda principal
app.post(['/search', '/api/search'], async (req, res) => {
    const {
        ruta,
        texto,
        subcarpetas = true,
        ignorarSistema = true,
        ignorarAcentos = true,
        palabraCompleta = false,
        distinguirMayus = false,
        extensiones = '*',
        searchId = null
    } = req.body;

    if (!ruta || !texto || !texto.trim()) {
        return res.status(400).json({ error: 'Debes ingresar una carpeta y el texto a buscar.' });
    }

    // Normalizar ruta Windows
    const cleanRuta = path.normalize(ruta.trim().replace(/^"(.*)"$/, '$1'));

    if (!fs.existsSync(cleanRuta)) {
        return res.status(400).json({ error: `La carpeta "${cleanRuta}" no existe o no se puede acceder.` });
    }

    let isDir = false;
    try {
        isDir = fs.statSync(cleanRuta).isDirectory();
    } catch (e) {
        return res.status(400).json({ error: `No se pudo verificar la carpeta: ${e.message}` });
    }

    if (!isDir) {
        return res.status(400).json({ error: `La ruta indicada no es una carpeta: ${cleanRuta}` });
    }

    // Registrar searchId
    const currentId = searchId || Date.now().toString();
    activeSearches.add(currentId);

    const isCancelled = () => !activeSearches.has(currentId);

    const startTime = Date.now();

    try {
        // Construir regex insensible a acentos
        const regex = buildSearchRegex(texto.trim(), {
            ignoreAccents: ignorarAcentos,
            matchCase: distinguirMayus,
            wholeWord: palabraCompleta
        });

        // 1. Recolectar archivos a revisar
        const files = await collectFiles(cleanRuta, {
            subcarpetas: Boolean(subcarpetas),
            ignorarSistema: Boolean(ignorarSistema),
            extensiones
        }, isCancelled);

        // 2. Procesar archivos con concurrencia
        const CONCURRENCY = 10;
        const resultados = [];
        let totalCoincidencias = 0;

        for (let i = 0; i < files.length; i += CONCURRENCY) {
            if (isCancelled()) break;
            const chunk = files.slice(i, i + CONCURRENCY);
            const chunkResults = await Promise.all(chunk.map(file => searchInFile(file, regex)));

            for (const r of chunkResults) {
                if (r && r.coincidencias && r.coincidencias.length > 0) {
                    resultados.push(r);
                    totalCoincidencias += r.coincidencias.length;
                }
            }
        }

        const endTime = Date.now();
        const durationSec = ((endTime - startTime) / 1000).toFixed(2);
        const wasCancelled = isCancelled();

        // Registrar en historial si no fue cancelado
        if (!wasCancelled) {
            recordFolderSearch(cleanRuta);
            recordQuerySearch(texto.trim(), cleanRuta, totalCoincidencias, resultados.length);
        }

        // Vista plana para compatibilidad con código anterior
        const lineasPlanas = [];
        for (const fileItem of resultados) {
            for (const match of fileItem.coincidencias) {
                lineasPlanas.push({
                    archivo: fileItem.archivo,
                    n_linea: match.n_linea,
                    contenido: match.contenido
                });
            }
        }

        res.json({
            resultados, // Agrupados por archivo (moderno y ordenado)
            lineasPlanas, // Planos para compatibilidad
            estadisticas: {
                totalArchivosAnalizados: files.length,
                archivosConCoincidencia: resultados.length,
                totalCoincidencias,
                tiempoSegundos: durationSec,
                cancelado: wasCancelled
            }
        });
    } catch (err) {
        console.error('Error durante la búsqueda:', err);
        res.status(500).json({ error: `Error al procesar la búsqueda: ${err.message}` });
    } finally {
        activeSearches.delete(currentId);
    }
});

// Endpoint para cancelar búsqueda
app.post('/api/cancel-search', (req, res) => {
    const { searchId } = req.body;
    if (searchId && activeSearches.has(searchId)) {
        activeSearches.delete(searchId);
        return res.json({ success: true, message: 'Búsqueda cancelada' });
    }
    res.json({ success: false, message: 'ID no encontrado o ya finalizado' });
});

// Endpoint para abrir explorador nativo de Windows (FolderBrowserDialog)
app.post('/api/browse-folder-windows', (req, res) => {
    const psScript = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Selecciona la carpeta donde deseas realizar la búsqueda'
    $dialog.ShowNewFolderButton = $true
    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    $result = $dialog.ShowDialog($form)
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Write-Output $dialog.SelectedPath
    }
    $form.Dispose()
    `;

    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', psScript], { encoding: 'utf8' }, (error, stdout) => {
        if (error) {
            return res.json({ success: false, error: error.message });
        }
        const selected = stdout.trim();
        if (!selected) {
            return res.json({ success: false, cancelled: true });
        }
        recordFolderSearch(selected);
        res.json({ success: true, folder: selected });
    });
});

// Endpoint para navegar el árbol de directorios en el navegador
app.get('/api/browse-tree', async (req, res) => {
    const targetDir = req.query.dir ? req.query.dir.trim() : '';

    if (!targetDir) {
        // Listar unidades disponibles en Windows (C:\, D:\, etc.)
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => l + ':\\');
        const drives = letters.filter(d => {
            try { return fs.existsSync(d); } catch (e) { return false; }
        }).map(d => ({ name: d, path: d, isDrive: true }));

        return res.json({
            current: '',
            parent: '',
            drives,
            subdirs: []
        });
    }

    try {
        const cleanDir = path.normalize(targetDir);
        if (!fs.existsSync(cleanDir)) {
            return res.status(404).json({ error: 'La carpeta no existe' });
        }

        const entries = await fsPromises.readdir(cleanDir, { withFileTypes: true });
        const subdirs = [];

        for (const e of entries) {
            if (e.isDirectory()) {
                subdirs.push({
                    name: e.name,
                    path: path.join(cleanDir, e.name)
                });
            }
        }

        subdirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        const parent = path.dirname(cleanDir);

        res.json({
            current: cleanDir,
            parent: parent !== cleanDir ? parent : '',
            subdirs
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoints de historial
app.get('/api/history', (req, res) => {
    res.json(getHistory());
});

app.post('/api/history/delete', (req, res) => {
    const { type, value } = req.body;
    const history = getHistory();

    if (type === 'folder') {
        history.recentFolders = history.recentFolders.filter(f => f.toLowerCase() !== (value || '').toLowerCase());
    } else if (type === 'search') {
        history.recentSearches = history.recentSearches.filter(s => s.id !== value && s.query !== value);
    }

    saveHistory(history);
    res.json({ success: true, history });
});

app.post('/api/history/clear', (req, res) => {
    const { type } = req.body;
    const history = getHistory();

    if (type === 'folders') {
        history.recentFolders = [];
    } else if (type === 'searches') {
        history.recentSearches = [];
    } else {
        history.recentFolders = [];
        history.recentSearches = [];
    }

    saveHistory(history);
    res.json({ success: true, history });
});

// Endpoint para abrir archivo en aplicación predeterminada
app.post('/api/open-file', (req, res) => {
    const { filePath } = req.body;
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    execFile('cmd.exe', ['/c', 'start', '', filePath], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Endpoint para abrir carpeta en Windows Explorer con el archivo seleccionado
app.post('/api/open-folder', (req, res) => {
    const { filePath, folderPath } = req.body;
    const target = filePath || folderPath;
    if (!target || !fs.existsSync(target)) {
        return res.status(404).json({ error: 'Ruta no encontrada' });
    }

    if (filePath) {
        execFile('explorer.exe', [`/select,${filePath}`], () => {});
    } else {
        execFile('explorer.exe', [folderPath], () => {});
    }
    res.json({ success: true });
});

// Iniciar servidor
app.listen(port, () => {
    console.log('============================================');
    console.log(`Buscador Local Avanzado iniciado en: http://localhost:${port}`);
    console.log('Presiona Ctrl+C para detener el servidor');
    console.log('============================================');
});